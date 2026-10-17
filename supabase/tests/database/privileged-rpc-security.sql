-- Canonical GitHub Actions entry point. The assertions live one level above so
-- the local and CI workflows execute the same database test body.
\ir ../privileged-rpc-security.sql
