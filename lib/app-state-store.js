const fs = require("node:fs/promises");
const path = require("node:path");

function normalizeMetadataProvider(value) {
  return String(value || "local").trim().toLowerCase();
}

function metadataStatusFromEnv(env = process.env) {
  const provider = normalizeMetadataProvider(env.METADATA_PROVIDER);
  const configured = provider === "supabase"
    ? Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
    : true;

  return {
    provider,
    mode: provider === "supabase" ? "supabase-postgres" : "local-json",
    configured,
    table: provider === "supabase" ? env.SUPABASE_APP_STATE_TABLE || "app_state" : null
  };
}

function stateKeyFromFilePath(filePath) {
  return path.basename(filePath, ".json");
}

function assertSupabaseMetadataConfig(env) {
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(`Supabase metadata store is not configured. Missing: ${missing.join(", ")}`);
  }
}

function createLocalAppStateStore() {
  return {
    provider: "local",
    async readJson(filePath, fallback) {
      try {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") {
          return fallback;
        }
        throw error;
      }
    },
    async writeJson(filePath, value) {
      await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    },
    async writeJsonAtomic(filePath, value) {
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await fs.rename(tempPath, filePath);
    }
  };
}

function createSupabaseAppStateStore({ env }) {
  assertSupabaseMetadataConfig(env);

  const table = env.SUPABASE_APP_STATE_TABLE || "app_state";
  let client = null;

  function supabase() {
    if (!client) {
      const { createClient } = require("@supabase/supabase-js");
      client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false }
      });
    }
    return client;
  }

  return {
    provider: "supabase",
    async readJson(filePath, fallback) {
      const key = stateKeyFromFilePath(filePath);
      const { data, error } = await supabase()
        .from(table)
        .select("value")
        .eq("key", key)
        .maybeSingle();

      if (error) {
        throw new Error(`Supabase metadata read failed for ${key}: ${error.message}`);
      }

      return data ? data.value : fallback;
    },
    async writeJson(filePath, value) {
      const key = stateKeyFromFilePath(filePath);
      const { error } = await supabase()
        .from(table)
        .upsert({
          key,
          value,
          updated_at: new Date().toISOString()
        }, {
          onConflict: "key"
        });

      if (error) {
        throw new Error(`Supabase metadata write failed for ${key}: ${error.message}`);
      }
    },
    async writeJsonAtomic(filePath, value) {
      await this.writeJson(filePath, value);
    }
  };
}

function createAppStateStore({ env = process.env } = {}) {
  const provider = normalizeMetadataProvider(env.METADATA_PROVIDER);

  if (provider === "supabase") {
    return createSupabaseAppStateStore({ env });
  }

  if (provider !== "local") {
    throw new Error(`Unsupported metadata provider: ${provider}`);
  }

  return createLocalAppStateStore();
}

module.exports = {
  createAppStateStore,
  createLocalAppStateStore,
  createSupabaseAppStateStore,
  metadataStatusFromEnv,
  normalizeMetadataProvider,
  stateKeyFromFilePath
};
