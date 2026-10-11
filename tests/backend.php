<?php
declare(strict_types=1);
require __DIR__.'/../private/bootstrap.php';
function check(bool $condition): void { if (!$condition) throw new RuntimeException('بررسی ناموفق بود.'); }
$a=['lat'=>0,'lng'=>0,'quality'=>'ok','gap'=>false];
$b=['lat'=>0,'lng'=>.01,'quality'=>'ok','gap'=>false];
$c=['lat'=>1,'lng'=>1,'quality'=>'ok','gap'=>true];
$d=['lat'=>1,'lng'=>1.01,'quality'=>'ok','gap'=>false];
check(abs(distance($a,$b)-1111.95)<.1);
[$meters,$first,$last]=stats([$a,$b,$c,$d]);
check($meters>2200 && $meters<2230);check($first===$a);check($last===$d);
$poor=['lat'=>.5,'lng'=>.5,'quality'=>'poor','gap'=>false];
[$meters]=stats([$a,$poor,$b]);check($meters===0.0 || $meters===0);
$p=validated_point(['seq'=>0,'lat'=>35,'lng'=>51,'time'=>1000,'accuracy'=>10,'altitude'=>null,'speed'=>null,'quality'=>'ok','gap'=>true]);
check($p===[0,35.0,51.0,1000,10.0,null,null,'ok',1]);
echo "بررسی محاسبات و اعتبارسنجی PHP موفق بود.\n";
