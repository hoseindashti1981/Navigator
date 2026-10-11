<?php
declare(strict_types=1);

function respond(array $data, int $status = 200): never {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    exit;
}
function fail(string $message, int $status = 400): never { respond(['error' => $message], $status); }
function text_value(mixed $v, int $max, bool $required = false): string {
    if (!is_string($v) || mb_strlen($v) > $max || ($required && trim($v) === '')) fail('متن واردشده معتبر نیست.');
    return trim($v);
}
function number_value(mixed $v, float $min, float $max): float {
    if ((!is_int($v) && !is_float($v)) || !is_finite((float)$v) || $v < $min || $v > $max) fail('مقدار عددی معتبر نیست.');
    return (float)$v;
}
function route_id(mixed $id): string {
    if (!is_string($id) || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D', $id)) fail('شناسهٔ مسیر معتبر نیست.');
    return $id;
}
function validated_point(array $p): array {
    $seq = number_value($p['seq'] ?? null, 0, 199999);
    if (floor($seq) !== $seq) fail('ترتیب نقطه معتبر نیست.');
    $quality = $p['quality'] ?? '';
    if (!in_array($quality, ['ok','poor','jump','duplicate'], true)) fail('وضعیت نقطه معتبر نیست.');
    return [(int)$seq, number_value($p['lat'] ?? null,-90,90), number_value($p['lng'] ?? null,-180,180),
        (int)number_value($p['time'] ?? null, 0, 4102444800000), number_value($p['accuracy'] ?? null,0,100000),
        isset($p['altitude']) ? number_value($p['altitude'],-12000,100000) : null,
        isset($p['speed']) ? number_value($p['speed'],0,1000) : null, $quality, !empty($p['gap']) ? 1 : 0];
}
function distance(array $a, array $b): float {
    $rad = M_PI / 180;
    $h = sin(($b['lat']-$a['lat'])*$rad/2)**2 + cos($a['lat']*$rad)*cos($b['lat']*$rad)*sin(($b['lng']-$a['lng'])*$rad/2)**2;
    return 6371008.8 * 2 * asin(sqrt(min(1, max(0, $h))));
}
function stats(array $points): array {
    $first = null; $previous = null; $last = null; $meters = 0; $broken = false;
    foreach ($points as $p) {
        if ($p['quality'] !== 'ok') { if ($p['quality'] !== 'duplicate') $broken = true; continue; }
        if ($previous && !$broken && !$p['gap']) $meters += distance($previous, $p);
        $first ??= $p; $last = $p; $previous = $p; $broken = false;
    }
    return [$meters, $first, $last];
}
function point_rows(PDO $db, string $id): array {
    $q = $db->prepare('SELECT seq,lat,lng,time_ms,accuracy,altitude,speed,quality,gap FROM points WHERE route_id=? ORDER BY seq');
    $q->execute([$id]);
    return array_map(function($p) {
        return ['seq'=>(int)$p['seq'],'lat'=>(float)$p['lat'],'lng'=>(float)$p['lng'],'time'=>(int)$p['time_ms'],
            'accuracy'=>(float)$p['accuracy'],'altitude'=>$p['altitude']===null?null:(float)$p['altitude'],
            'speed'=>$p['speed']===null?null:(float)$p['speed'],'quality'=>$p['quality'],'gap'=>(bool)$p['gap']];
    }, $q->fetchAll());
}
