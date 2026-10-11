<?php
return [
    'dsn' => 'mysql:host=localhost;dbname=YOUR_DATABASE;charset=utf8mb4',
    'db_user' => 'YOUR_DATABASE_USER',
    'db_password' => 'YOUR_DATABASE_PASSWORD',
    // یک عبارت تصادفی حداقل ۳۲ نویسه‌ای؛ پس از ساخت حساب آن را خالی کنید.
    'setup_token' => 'REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS',
    'require_https' => true,
    // تنها برای استفادهٔ شخصی کم‌ترافیک؛ شرایط سرویس را در راهنما بخوانید.
    'tile_url' => 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    'tile_attribution' => '© OpenStreetMap contributors',
];
