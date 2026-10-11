<?php
// Only provisions a disposable local test database. Never run against a hosting database.
declare(strict_types=1);
if (getenv('NAVIGATOR_TEST_ALLOW')!=='1') exit("فقط برای محیط آزمون محلی مجاز است.\n");
$path=__DIR__.'/../private/config.php';
if(is_file($path))exit("فایل تنظیمات از قبل وجود دارد؛ بازنویسی نشد.\n");
$port=(int)(getenv('NAVIGATOR_TEST_DB_PORT') ?: 33077);
$password=getenv('NAVIGATOR_TEST_DB_PASSWORD') ?: '';
$db=new PDO("mysql:host=127.0.0.1;port=$port;charset=utf8mb4",'root',$password,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$db->exec('CREATE DATABASE IF NOT EXISTS navigator_test CHARACTER SET utf8mb4');
$db->exec('USE navigator_test');
$db->exec(file_get_contents(__DIR__.'/../database/schema.sql'));
$config=['dsn'=>"mysql:host=127.0.0.1;port=$port;dbname=navigator_test;charset=utf8mb4",'db_user'=>'root','db_password'=>$password,
    'setup_token'=>'local-test-setup-token-not-for-production-123456789','require_https'=>false,
    'tile_url'=>'https://tile.openstreetmap.org/{z}/{x}/{y}.png','tile_attribution'=>'© OpenStreetMap contributors'];
file_put_contents($path,"<?php\nreturn ".var_export($config,true).";\n");
echo "پایگاه آزمون و تنظیمات محلی آماده شد.\n";
