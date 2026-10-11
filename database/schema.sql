CREATE TABLE users (
 id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
 username VARCHAR(100) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE login_limits (
 bucket CHAR(64) NOT NULL PRIMARY KEY,
 attempts INT UNSIGNED NOT NULL DEFAULT 0,
 started_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE routes (
 id CHAR(36) NOT NULL PRIMARY KEY,
 user_id TINYINT UNSIGNED NOT NULL,
 name VARCHAR(200) NOT NULL,
 description TEXT NOT NULL,
 mode ENUM('driving','walking') NOT NULL,
 status ENUM('draft','saved','deleted') NOT NULL DEFAULT 'draft',
 created_ms BIGINT NOT NULL,
 duration_ms BIGINT NOT NULL DEFAULT 0,
 distance_m DOUBLE NOT NULL DEFAULT 0,
 point_count INT UNSIGNED NOT NULL DEFAULT 0,
 origin_lat DOUBLE NULL,
 origin_lng DOUBLE NULL,
 destination_lat DOUBLE NULL,
 destination_lng DOUBLE NULL,
 INDEX route_list (user_id,status,created_ms),
 FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE points (
 route_id CHAR(36) NOT NULL,
 seq INT UNSIGNED NOT NULL,
 lat DOUBLE NOT NULL,
 lng DOUBLE NOT NULL,
 time_ms BIGINT NOT NULL,
 accuracy DOUBLE NOT NULL,
 altitude DOUBLE NULL,
 speed DOUBLE NULL,
 quality ENUM('ok','poor','jump','duplicate') NOT NULL,
 gap TINYINT UNSIGNED NOT NULL DEFAULT 0,
 PRIMARY KEY (route_id,seq),
 FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
