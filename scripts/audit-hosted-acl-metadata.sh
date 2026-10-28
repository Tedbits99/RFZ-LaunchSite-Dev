#!/usr/bin/env bash
set -euo pipefail

expected_project='ketdhcmwowzztcdlmris'
: "${PROJECT_ID:?Verified project ID is required}"
: "${PROJECT_REGION:?Verified project region is required}"
: "${POOLER_PORT:?Verified pooler port is required}"
: "${SUPABASE_POOLER_HOST:?Verified pooler host is required}"
: "${SUPABASE_DB_USER:?Verified database username is required}"
: "${SUPABASE_DB_PASSWORD:?Protected database password is required}"
: "${SOURCE_SHA:?Verified trusted source SHA is required}"
: "${GITHUB_SHA:?Workflow SHA is required}"
: "${GITHUB_RUN_ID:?Workflow run ID is required}"
: "${RUNNER_TEMP:?Runner temporary directory is required}"

[[ "$PROJECT_ID" = "$expected_project" ]] || {
  echo 'HOSTED_ACL_METADATA_AUDIT_BLOCKED=unexpected_project' >&2
  exit 1
}
[[ "${GITHUB_REF:-}" = 'refs/heads/main' && "$SOURCE_SHA" = "$GITHUB_SHA" ]] || {
  echo 'HOSTED_ACL_METADATA_AUDIT_BLOCKED=trusted_main_sha_mismatch' >&2
  exit 1
}
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo 'HOSTED_ACL_METADATA_AUDIT_BLOCKED=invalid_source_sha' >&2
  exit 1
}
[[ "$POOLER_PORT" = '5432' || "$POOLER_PORT" = '6543' ]] || {
  echo 'HOSTED_ACL_METADATA_AUDIT_BLOCKED=unexpected_pooler_port' >&2
  exit 1
}
command -v psql >/dev/null 2>&1 || {
  echo 'HOSTED_ACL_METADATA_AUDIT_BLOCKED=psql_unavailable' >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  echo 'HOSTED_ACL_METADATA_AUDIT_BLOCKED=jq_unavailable' >&2
  exit 1
}

expected_pooler_host="aws-0-${PROJECT_REGION}.pooler.supabase.com"
expected_db_user="postgres.${PROJECT_ID}"
[[ "$SUPABASE_POOLER_HOST" = "$expected_pooler_host" && "$SUPABASE_DB_USER" = "$expected_db_user" ]] || {
  echo 'HOSTED_ACL_METADATA_AUDIT_BLOCKED=unexpected_database_target' >&2
  exit 1
}
db_connection="host=$SUPABASE_POOLER_HOST port=$POOLER_PORT user=$SUPABASE_DB_USER dbname=postgres sslmode=require connect_timeout=10"
query_file="${GITHUB_WORKSPACE:?Trusted workspace is required}/supabase/tests/hosted-acl-metadata-audit.sql"
artifact_file="$RUNNER_TEMP/hosted-acl-metadata.json"
audit_tmp="$(mktemp -d "$RUNNER_TEMP/hosted-acl-metadata.XXXXXX")"
trap 'rm -rf -- "$audit_tmp"' EXIT

test -s "$query_file" || {
  echo 'HOSTED_ACL_METADATA_AUDIT_BLOCKED=trusted_query_missing' >&2
  exit 1
}

# psql receives one connection string. The password is only in its environment;
# it is never placed in arguments, logs, generated metadata, or artifacts.
if ! PGPASSWORD="$SUPABASE_DB_PASSWORD" \
  PGOPTIONS='-c statement_timeout=30000 -c lock_timeout=5000' \
  psql "$db_connection" --no-psqlrc --quiet --tuples-only --no-align \
    --set ON_ERROR_STOP=1 --file "$query_file" \
    > "$audit_tmp/records.jsonl" 2> "$audit_tmp/query-error.log"; then
  echo 'HOSTED_ACL_METADATA_AUDIT_FAIL=postgres_metadata_query' >&2
  exit 1
fi

record_count="$(wc -l < "$audit_tmp/records.jsonl" | tr -d '[:space:]')"
record_bytes="$(wc -c < "$audit_tmp/records.jsonl" | tr -d '[:space:]')"
[[ "$record_count" -eq 9 && "$record_bytes" -le 4194304 ]] || {
  echo 'HOSTED_ACL_METADATA_AUDIT_FAIL=metadata_output_bounds_or_section_count' >&2
  exit 1
}

captured_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
jq -s -e \
  --arg source_sha "$SOURCE_SHA" \
  --arg run_id "$GITHUB_RUN_ID" \
  --arg run_attempt "${GITHUB_RUN_ATTEMPT:-1}" \
  --arg captured_at "$captured_at" \
  --arg project_ref "$PROJECT_ID" \
  --arg workflow_ref "${GITHUB_WORKFLOW_REF:-unknown}" \
  '
    def section($name):
      [.[] | select(.section == $name)] as $matches
      | if ($matches | length) == 1 then $matches[0].data
        else error("missing_or_duplicate_section:" + $name) end;
    if length != 9 then error("unexpected_record_count") else . end
    | {
        metadata: {
          source_sha: $source_sha,
          workflow_run_id: $run_id,
          workflow_run_attempt: $run_attempt,
          captured_at_utc: $captured_at,
          project_ref: $project_ref,
          workflow_ref: $workflow_ref,
          data_rows_exported: false
        },
        database: section("database"),
        tables: section("tables"),
        effective_table_privileges: section("effective_table_privileges"),
        direct_relation_acl: section("direct_relation_acl"),
        default_acl: section("default_acl"),
        role_memberships: section("role_memberships"),
        payment_transactions: section("payment_transactions"),
        public_functions: section("public_functions"),
        scheduled_jobs: section("scheduled_jobs")
      }
    | if (.database.required_roles_present != true) then error("required_roles_missing") else . end
    | if (.database.server_version_num < 170000) then error("postgresql_17_or_newer_required") else . end
    | if ((.database.extensions | type) != "array"
          or (.database.rf_coin_tables | type) != "array"
          or (.database.rf_coin_functions | type) != "array") then error("database_metadata_incomplete") else . end
    | if (.database.public_table_count < 1 or (.tables | length) != .database.public_table_count) then error("table_inventory_incomplete") else . end
    | if ((.effective_table_privileges | type) != "array"
          or (.effective_table_privileges | length) != (.database.public_table_count * 2)
          or (all(.effective_table_privileges[]; . as $entry
            | ($entry.table | type) == "string"
              and ($entry.role == "anon" or $entry.role == "authenticated")
              and ($entry.privileges | type) == "object"
              and (["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]
                | all(. as $privilege | $entry.privileges[$privilege] | type == "boolean")))) == false)
      then error("effective_acl_inventory_incomplete") else . end
    | if ((.direct_relation_acl | type) != "array"
          or (.direct_relation_acl | length) != .database.public_table_count
          or (all(.direct_relation_acl[];
            (.table | type) == "string" and (.relacl_is_null | type) == "boolean"
            and (.entries | type) == "array"))) == false then error("direct_acl_inventory_incomplete") else . end
    | if ((.tables | all(.[];
        (.name | type) == "string" and (.owner | type) == "string"
        and (.rls_enabled | type) == "boolean" and (.rls_forced | type) == "boolean"
        and (.relacl_is_null | type) == "boolean")) == false) then error("table_metadata_incomplete") else . end
    | if ((.default_acl | type) != "array"
          or (.default_acl | length) > 2000
          or (all(.default_acl[];
            (.creator | type) == "string" and (.schema | type) == "string"
            and (.grantor | type) == "string" and (.grantee | type) == "string"
            and (.privilege | type) == "string" and (.grantable | type) == "boolean")) == false)
      then error("default_acl_inventory_incomplete") else . end
    | if ((.role_memberships | type) != "array"
          or (all(.role_memberships[];
            (.root_role | type) == "string" and (.granted_role | type) == "string"
            and (.membership_path | type) == "array" and (.depth | type) == "number"
            and (.all_edges_inherit | type) == "boolean")) == false)
      then error("role_membership_inventory_incomplete") else . end
    | if (.payment_transactions.exists != true
          or (.payment_transactions.constraints | type) != "array"
          or (.payment_transactions.indexes | type) != "array"
          or (.payment_transactions.policies | type) != "array"
          or (.payment_transactions.rls_enabled | type) != "boolean") then error("payment_transactions_metadata_incomplete") else . end
    | if ((.public_functions | type) != "array"
          or (.public_functions | length) > 2000
          or (all(.public_functions[];
            (.identity | type) == "string" and (.owner | type) == "string"
            and (.security_definer | type) == "boolean"
            and (.anon_execute | type) == "boolean"
            and (.authenticated_execute | type) == "boolean"
            and (.service_role_execute | type) == "boolean")) == false)
      then error("function_security_inventory_incomplete") else . end
    | if ((.scheduled_jobs.cron_relation_present | type) != "boolean"
          or (.scheduled_jobs.job_count | type) != "number") then error("scheduled_job_inventory_incomplete") else . end
  ' "$audit_tmp/records.jsonl" > "$artifact_file"

test -s "$artifact_file" || {
  echo 'HOSTED_ACL_METADATA_AUDIT_FAIL=artifact_missing' >&2
  exit 1
}
artifact_bytes="$(wc -c < "$artifact_file" | tr -d '[:space:]')"
[[ "$artifact_bytes" -le 4194304 ]] || {
  rm -f -- "$artifact_file"
  echo 'HOSTED_ACL_METADATA_AUDIT_FAIL=artifact_size_limit' >&2
  exit 1
}

table_count="$(jq -r '.database.public_table_count' "$artifact_file")"
effective_count="$(jq -r '.effective_table_privileges | length' "$artifact_file")"
function_count="$(jq -r '.public_functions | length' "$artifact_file")"
echo "HOSTED_ACL_METADATA_AUDIT_PASS project=$PROJECT_ID source_sha=$SOURCE_SHA run_id=$GITHUB_RUN_ID postgres=17 tables=$table_count effective_acl_rows=$effective_count functions=$function_count rows_exported=false artifact=hosted-acl-metadata.json"
