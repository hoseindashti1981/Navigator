<?php
declare(strict_types=1);
require __DIR__ . '/../private/bootstrap.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
ini_set('display_errors', '0');
set_exception_handler(function(Throwable $e) {
    error_log('Navigator API failure: ' . get_class($e));
    fail('ارتباط با سرور انجام نشد. تنظیمات یا اتصال پایگاه داده را بررسی کنید.', 500);
});
if (!is_file(__DIR__ . '/../private/config.php')) respond(['configured'=>false,'error'=>'تنظیمات سرور هنوز انجام نشده است. راهنمای نصب را بخوانید.'],503);
$config = require __DIR__ . '/../private/config.php';
$https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
if (($config['require_https'] ?? true) && !$https) fail('برای استفاده از برنامه اتصال امن HTTPS لازم است.',403);
if ($https) header('Strict-Transport-Security: max-age=31536000');
ini_set('session.use_strict_mode','1');
ini_set('session.use_only_cookies','1');
ini_set('session.gc_maxlifetime','43200');
session_name('navigator_session');
session_set_cookie_params(['lifetime'=>0,'path'=>'/','secure'=>$https,'httponly'=>true,'samesite'=>'Strict']);
session_start();
$_SESSION['csrf'] ??= bin2hex(random_bytes(32));
if (isset($_SESSION['last']) && time() - $_SESSION['last'] > 43200) unset($_SESSION['user']);
$_SESSION['last'] = time();
$db = new PDO($config['dsn'],$config['db_user'],$config['db_password'],[
    PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES=>false,
]);
$action = $_GET['action'] ?? 'me';
if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'me') {
    $hasUser = (bool)$db->query('SELECT COUNT(*) FROM users')->fetchColumn();
    respond(['configured'=>true,'setup'=>!$hasUser,'authenticated'=>isset($_SESSION['user']),
        'user'=>$_SESSION['user'] ?? null,'csrf'=>$_SESSION['csrf'],
        'tile_url'=>$config['tile_url'],'tile_attribution'=>$config['tile_attribution']]);
}
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('این روش درخواست پشتیبانی نمی‌شود.',405);
    if (!hash_equals($_SESSION['csrf'], $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '')) fail('نشست معتبر نیست. صفحه را تازه‌سازی کنید.',403);
    $raw = file_get_contents('php://input', false, null, 0, 300001);
    if (strlen($raw) > 300000) fail('حجم درخواست بیش از حد مجاز است.',413);
    try { $input = json_decode($raw, true, 64, JSON_THROW_ON_ERROR); }
    catch (JsonException) { fail('دادهٔ ارسالی خوانا نیست.'); }
    if (!is_array($input)) fail('دادهٔ ارسالی معتبر نیست.');
} else $input = [];
if (in_array($action,['login','setup'],true)) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('روش درخواست معتبر نیست.',405);
    // Count before verification, including setup failures. REMOTE_ADDR is not a client-supplied forwarding header.
    $buckets = [hash('sha256','ip:'.($_SERVER['REMOTE_ADDR'] ?? 'local')),hash('sha256','global')];
    $db->beginTransaction();
    foreach ($buckets as $i=>$bucket) {
        $q=$db->prepare('INSERT INTO login_limits (bucket,attempts,started_at) VALUES (?,0,?) ON DUPLICATE KEY UPDATE bucket=bucket');
        $q->execute([$bucket,time()]);
        $q=$db->prepare('SELECT * FROM login_limits WHERE bucket=? FOR UPDATE'); $q->execute([$bucket]); $limit=$q->fetch();
        $n = time()-(int)$limit['started_at'] > 900 ? 0 : (int)$limit['attempts'];
        if ($n >= ($i===0?10:80)) { $db->rollBack(); fail('تلاش‌های ورود زیاد است. ۱۵ دقیقه بعد دوباره امتحان کنید.',429); }
        $q=$db->prepare('UPDATE login_limits SET attempts=?,started_at=? WHERE bucket=?');
        $q->execute([$n+1,$n===0?time():$limit['started_at'],$bucket]);
    }
    $db->commit();
    $username = text_value($input['username'] ?? '',100,true);
    $password = $input['password'] ?? '';
    if (!is_string($password) || strlen($password)>256) fail('رمز عبور معتبر نیست.');
    if ($action === 'setup') {
        if ($db->query('SELECT COUNT(*) FROM users')->fetchColumn()) fail('حساب قبلاً ساخته شده است.',403);
        $token=$config['setup_token'] ?? '';
        if (strlen($token)<32 || str_starts_with($token,'REPLACE_') || !is_string($input['token'] ?? null) || !hash_equals($token,$input['token'])) fail('کلید راه‌اندازی معتبر نیست.',403);
        if (strlen($password)<12 || strlen($password)>72) fail('رمز باید بین ۱۲ تا ۷۲ بایت باشد.');
        $q=$db->prepare('INSERT INTO users (id,username,password_hash) VALUES (1,?,?)');
        $q->execute([$username,password_hash($password,PASSWORD_DEFAULT)]);
    } else {
        $q=$db->prepare('SELECT * FROM users WHERE id=1'); $q->execute(); $user=$q->fetch();
        if (!$user || !hash_equals($user['username'],$username) || !password_verify($password,$user['password_hash'])) fail('نام کاربری یا رمز عبور نادرست است.',401);
    }
    session_regenerate_id(true); $_SESSION['user']=1; $_SESSION['csrf']=bin2hex(random_bytes(32));
    respond(['ok'=>true,'csrf'=>$_SESSION['csrf'],'user'=>1]);
}
if (!isset($_SESSION['user'])) fail('برای ادامه وارد حساب شوید. نقاط روی این دستگاه حفظ شده‌اند.',401);
$uid=(int)$_SESSION['user'];
if ($action === 'logout' && $_SERVER['REQUEST_METHOD']==='POST') {
    $_SESSION=[]; session_destroy(); respond(['ok'=>true]);
}
if ($action === 'list' && $_SERVER['REQUEST_METHOD']==='GET') {
    $q=$db->prepare("SELECT * FROM routes WHERE user_id=? AND status<>'deleted' ORDER BY created_ms DESC"); $q->execute([$uid]);
    respond(['routes'=>$q->fetchAll()]);
}
$id=route_id($_GET['id'] ?? $input['id'] ?? null);
if ($action === 'route' && $_SERVER['REQUEST_METHOD']==='GET') {
    $q=$db->prepare("SELECT * FROM routes WHERE id=? AND user_id=? AND status<>'deleted'"); $q->execute([$id,$uid]);
    $route=$q->fetch(); if (!$route) fail('مسیر پیدا نشد.',404);
    respond(['route'=>$route,'points'=>point_rows($db,$id)]);
}
if ($_SERVER['REQUEST_METHOD']!=='POST') fail('درخواست پشتیبانی نمی‌شود.',405);
$db->beginTransaction();
if ($action === 'sync') {
    $name=text_value($input['name'] ?? '',200,true);
    $mode=$input['mode'] ?? ''; if (!in_array($mode,['driving','walking'],true)) fail('نوع حرکت معتبر نیست.');
    $created=(int)number_value($input['created'] ?? null,0,4102444800000);
    $q=$db->prepare("INSERT INTO routes (id,user_id,name,description,mode,created_ms) VALUES (?,?,?,'',?,?) ON DUPLICATE KEY UPDATE id=id");
    $q->execute([$id,$uid,$name,$mode,$created]);
}
$q=$db->prepare('SELECT * FROM routes WHERE id=? AND user_id=? FOR UPDATE'); $q->execute([$id,$uid]); $route=$q->fetch();
if (!$route) { $db->rollBack(); fail('مسیر پیدا نشد.',404); }
if ($route['status']==='deleted') { $db->rollBack(); fail('این مسیر قبلاً حذف شده است.',410); }
switch ($action) {
    case 'sync':
        if ($route['status']==='saved') { $db->commit(); respond(['count'=>(int)$route['point_count'],'saved'=>true]); }
        if ($route['mode']!==$mode || (int)$route['created_ms']!==$created) fail('مشخصات ضبط با نسخهٔ سرور متفاوت است.',409);
        $batch=$input['points'] ?? null;
        if (!is_array($batch) || count($batch)>400) fail('تعداد نقاط ارسالی معتبر نیست.');
        $count=(int)$route['point_count'];
        $q=$db->prepare('SELECT time_ms FROM points WHERE route_id=? ORDER BY seq DESC LIMIT 1'); $q->execute([$id]); $lastTime=$q->fetchColumn();
        $insert=$db->prepare('INSERT INTO points (route_id,seq,lat,lng,time_ms,accuracy,altitude,speed,quality,gap) VALUES (?,?,?,?,?,?,?,?,?,?)');
        foreach ($batch as $p) {
            if (!is_array($p)) fail('نقطهٔ ارسالی معتبر نیست.');
            $v=validated_point($p);
            if ($v[0]<$count) {
                $existing=$db->prepare('SELECT seq,lat,lng,time_ms,accuracy,altitude,speed,quality,gap FROM points WHERE route_id=? AND seq=?');
                $existing->execute([$id,$v[0]]);
                if (array_values($existing->fetch()) != $v) fail('نقطهٔ تکراری با دادهٔ قبلی تفاوت دارد.',409);
                continue;
            }
            if ($v[0]!==$count || ($lastTime!==false && $v[3]<=(int)$lastTime)) fail('ترتیب نقاط ناقص است. دوباره همگام‌سازی کنید.',409);
            $insert->execute([$id,...$v]); $count++; $lastTime=$v[3];
        }
        $duration=(int)number_value($input['duration'] ?? 0,0,31536000000);
        $q=$db->prepare('UPDATE routes SET point_count=?,duration_ms=GREATEST(duration_ms,?) WHERE id=?'); $q->execute([$count,$duration,$id]);
        $db->commit(); respond(['count'=>$count]);
    case 'finish':
        if ($route['status']==='saved') { $db->commit(); respond(['ok'=>true]); }
        $expected=(int)number_value($input['count'] ?? null,1,200000);
        if ($expected!==(int)$route['point_count']) fail('همهٔ نقاط هنوز به سرور نرسیده‌اند.',409);
        [$meters,$first,$last]=stats(point_rows($db,$id));
        if (!$first) fail('مسیر هیچ نقطهٔ قابل اعتمادی ندارد. ضبط را ادامه دهید.');
        $name=text_value($input['name'] ?? '',200,true);
        $description=text_value($input['description'] ?? '',4000);
        $duration=(int)number_value($input['duration'] ?? 0,0,31536000000);
        $q=$db->prepare("UPDATE routes SET status='saved',name=?,description=?,duration_ms=?,distance_m=?,origin_lat=?,origin_lng=?,destination_lat=?,destination_lng=? WHERE id=?");
        $q->execute([$name,$description,$duration,$meters,$first['lat'],$first['lng'],$last['lat'],$last['lng'],$id]);
        $db->commit(); respond(['ok'=>true]);
    case 'edit':
        $q=$db->prepare('UPDATE routes SET name=?,description=? WHERE id=?');
        $q->execute([text_value($input['name'] ?? '',200,true),text_value($input['description'] ?? '',4000),$id]);
        $db->commit(); respond(['ok'=>true]);
    case 'delete':
        $q=$db->prepare("UPDATE routes SET status='deleted',name='',description='',mode='driving',created_ms=0,duration_ms=0,distance_m=0,point_count=0,origin_lat=NULL,origin_lng=NULL,destination_lat=NULL,destination_lng=NULL WHERE id=?"); $q->execute([$id]);
        $q=$db->prepare('DELETE FROM points WHERE route_id=?'); $q->execute([$id]);
        $db->commit(); respond(['ok'=>true]);
    default: $db->rollBack(); fail('درخواست شناخته نشد.',404);
}
