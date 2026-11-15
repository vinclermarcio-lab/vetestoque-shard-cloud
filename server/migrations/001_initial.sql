CREATE TABLE users (
 id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
 password_hash text NOT NULL, role text NOT NULL CHECK(role='admin'),
 active boolean NOT NULL DEFAULT true, created timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id),
 csrf text NOT NULL, expires timestamptz NOT NULL
);
CREATE INDEX sessions_expiry_idx ON sessions(expires);
CREATE TABLE login_attempts (key text PRIMARY KEY, failures integer NOT NULL DEFAULT 0, window_start timestamptz NOT NULL DEFAULT now());
CREATE TABLE replenisher_links (
 id text PRIMARY KEY, token_hash text NOT NULL UNIQUE, name text NOT NULL,
 active boolean NOT NULL DEFAULT true, expires timestamptz NOT NULL,
 created timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL REFERENCES users(id)
);
CREATE TABLE records (
 id text PRIMARY KEY, kind text NOT NULL CHECK(kind IN('product','supplier','sector')),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), document text UNIQUE,
 product_key text UNIQUE, revision integer NOT NULL DEFAULT 1 CHECK(revision>0)
);
CREATE INDEX records_kind_idx ON records(kind);
CREATE TABLE lots (
 id text PRIMARY KEY, product text NOT NULL REFERENCES records(id), code text NOT NULL,
 expiry date NOT NULL, sector text NOT NULL CHECK(sector='__central__'),
 qty numeric(18,3) NOT NULL CHECK(qty>=0), cost numeric(18,6) NOT NULL CHECK(cost>=0)
);
CREATE INDEX lots_fefo_idx ON lots(product,expiry,id);
CREATE TABLE replenishments (
 id text PRIMARY KEY, number text NOT NULL UNIQUE, destination text NOT NULL REFERENCES records(id),
 responsible text NOT NULL,note text NOT NULL,items jsonb NOT NULL,created timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE movements (
 id text PRIMARY KEY, type text NOT NULL CHECK(type IN('Entrada','Saída','Perda','Transferência')),
 product text NOT NULL REFERENCES records(id),lot text NOT NULL REFERENCES lots(id),
 qty numeric(18,3) NOT NULL CHECK(qty>0),origin text NOT NULL,destination text NOT NULL,
 responsible text NOT NULL,note text NOT NULL,created timestamptz NOT NULL DEFAULT now(),
 request_id text REFERENCES replenishments(id),actor text NOT NULL
);
CREATE INDEX movements_lot_idx ON movements(lot);
CREATE INDEX movements_created_idx ON movements(created DESC);
CREATE TABLE mobile_requests (
 id text PRIMARY KEY,number text NOT NULL UNIQUE,destination text NOT NULL REFERENCES records(id),
 responsible text NOT NULL,note text NOT NULL,items jsonb NOT NULL,payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','confirmed','rejected')),
 created timestamptz NOT NULL DEFAULT now(),submitted_account text NOT NULL,
 processed timestamptz,processed_by text,processed_account text,rejection_reason text
);
CREATE INDEX mobile_requests_status_idx ON mobile_requests(status,created DESC);
CREATE TABLE idempotency (
 key text PRIMARY KEY,actor text NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,created timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit (
 id text PRIMARY KEY,actor text NOT NULL,action text NOT NULL,target text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}',created timestamptz NOT NULL DEFAULT now()
);
