const fs = require("node:fs/promises");
const path = require("node:path");

function normalizeStorageProvider(value) {
  return String(value || "local").trim().toLowerCase();
}

function normalizeStorageContentType(value) {
  const contentType = String(value || "").split(";")[0].trim().toLowerCase();
  return contentType || "application/octet-stream";
}

function storageStatusFromEnv(env = process.env) {
  const provider = normalizeStorageProvider(env.STORAGE_PROVIDER);
  const supabaseConfigured = Boolean(
    env.SUPABASE_URL &&
    env.SUPABASE_SERVICE_ROLE_KEY &&
    env.SUPABASE_BUCKET
  );

  return {
    provider,
    mode: provider === "supabase" ? "real-cloud" : "local-demo",
    configured: provider === "supabase" ? supabaseConfigured : true,
    bucket: provider === "supabase" ? env.SUPABASE_BUCKET || null : null
  };
}

function assertSupabaseConfig(env) {
  const missing = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_BUCKET"
  ].filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(`Supabase storage is not configured. Missing: ${missing.join(", ")}`);
  }
}

function createLocalStorageAdapter({ localDir }) {
  return {
    provider: "local",
    async uploadObject({ objectKey, content, contentType }) {
      const normalizedContentType = normalizeStorageContentType(contentType);
      await fs.mkdir(localDir, { recursive: true });
      await fs.writeFile(path.join(localDir, objectKey), content, "utf8");
      return {
        provider: "local",
        objectKey,
        bucket: null,
        contentType: normalizedContentType,
        location: `local://cloud-objects/${objectKey}`
      };
    },
    async readObject(objectKey) {
      return fs.readFile(path.join(localDir, objectKey), "utf8");
    }
  };
}

function createSupabaseStorageAdapter({ env }) {
  assertSupabaseConfig(env);

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
    async uploadObject({ objectKey, content, contentType }) {
      const body = Buffer.from(String(content), "utf8");
      const normalizedContentType = normalizeStorageContentType(contentType);
      const { data, error } = await supabase()
        .storage
        .from(env.SUPABASE_BUCKET)
        .upload(objectKey, body, {
          contentType: normalizedContentType,
          upsert: false
        });

      if (error) {
        throw new Error(`Supabase upload failed: ${error.message}`);
      }

      return {
        provider: "supabase",
        objectKey: data.path || objectKey,
        bucket: env.SUPABASE_BUCKET,
        contentType: normalizedContentType,
        location: `supabase://${env.SUPABASE_BUCKET}/${data.path || objectKey}`
      };
    },
    async readObject(objectKey) {
      const { data, error } = await supabase()
        .storage
        .from(env.SUPABASE_BUCKET)
        .download(objectKey);

      if (error) {
        throw new Error(`Supabase download failed: ${error.message}`);
      }

      if (data && typeof data.text === "function") {
        return data.text();
      }

      const arrayBuffer = await data.arrayBuffer();
      return Buffer.from(arrayBuffer).toString("utf8");
    }
  };
}

function createStorageAdapter({ env = process.env, localDir }) {
  const provider = normalizeStorageProvider(env.STORAGE_PROVIDER);

  if (provider === "supabase") {
    return createSupabaseStorageAdapter({ env });
  }

  if (provider !== "local") {
    throw new Error(`Unsupported storage provider: ${provider}`);
  }

  return createLocalStorageAdapter({ localDir });
}

module.exports = {
  createLocalStorageAdapter,
  createStorageAdapter,
  normalizeStorageContentType,
  normalizeStorageProvider,
  storageStatusFromEnv
};
