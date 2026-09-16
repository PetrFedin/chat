import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

function boolEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());
}

function safeKey(key) {
  const value = String(key ?? '').replace(/^\/+/, '');
  if (!value || value.includes('..') || value.includes('\\')) {
    const error = new Error('Invalid object storage key');
    error.code = 'INVALID_STORAGE_KEY';
    error.statusCode = 400;
    throw error;
  }
  return value;
}

export class LocalObjectStore {
  constructor(root) {
    this.root = normalize(root);
  }

  status() {
    return { provider: 'local', enabled: true };
  }

  path(key) {
    const candidate = normalize(join(this.root, safeKey(key)));
    if (!candidate.startsWith(this.root)) {
      const error = new Error('Invalid object storage path');
      error.code = 'INVALID_STORAGE_PATH';
      error.statusCode = 400;
      throw error;
    }
    return candidate;
  }

  async put(key, body) {
    const path = this.path(key);
    await mkdir(path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))), { recursive: true });
    await writeFile(path, body);
  }

  async get(key) {
    return readFile(this.path(key));
  }

  async head(key) {
    try {
      const info = await stat(this.path(key));
      return { exists: info.isFile(), sizeBytes: info.size, lastModified: info.mtime.toISOString() };
    } catch (error) {
      if (error?.code === 'ENOENT') return { exists: false, sizeBytes: null, lastModified: null };
      throw error;
    }
  }

  async delete(key) {
    await rm(this.path(key), { force: true });
  }
}

export class S3ObjectStore {
  constructor(env = process.env) {
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.S3_REGION || 'us-east-1',
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: boolEnv(env.S3_FORCE_PATH_STYLE),
      credentials: env.S3_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID
        ? {
            accessKeyId: env.S3_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
    });
  }

  status() {
    return { provider: 's3', enabled: true, bucketConfigured: Boolean(this.bucket) };
  }

  async put(key, body, contentType = 'application/octet-stream') {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: safeKey(key),
      Body: body,
      ContentType: contentType,
      ServerSideEncryption: process.env.S3_SERVER_SIDE_ENCRYPTION || undefined,
    }));
  }

  async get(key) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
    if (!result.Body) return Buffer.alloc(0);
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async head(key) {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
      return {
        exists: true,
        sizeBytes: result.ContentLength ?? null,
        contentType: result.ContentType ?? null,
        etag: result.ETag ?? null,
        lastModified: result.LastModified?.toISOString?.() ?? null,
      };
    } catch (error) {
      const code = error?.name || error?.Code || error?.code;
      const status = error?.$metadata?.httpStatusCode;
      if (status === 404 || code === 'NotFound' || code === 'NoSuchKey') return { exists: false, sizeBytes: null };
      throw error;
    }
  }

  async delete(key) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
  }
}

export function createObjectStore({ uploadsRoot, env = process.env }) {
  if (env.S3_BUCKET) return new S3ObjectStore(env);
  return new LocalObjectStore(uploadsRoot);
}
