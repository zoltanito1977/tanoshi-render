// Uploads finished files to Cloudflare R2 through its S3-compatible API.
import fs from 'node:fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export function makeR2({ accountId, accessKeyId, secretAccessKey, bucket, publicBase }) {
  const client = new S3Client({
    region: 'auto',
    endpoint: 'https://' + accountId + '.r2.cloudflarestorage.com',
    credentials: { accessKeyId, secretAccessKey },
  });
  const base = String(publicBase || '').replace(/\/+$/, '');
  return {
    async upload(key, filePath, contentType) {
      const body = fs.readFileSync(filePath);
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000' }));
      return base + '/' + key;
    },
  };
}
