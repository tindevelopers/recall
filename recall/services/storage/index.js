import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl as getSignedS3Url } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";

/**
 * S3-compatible storage service (AWS S3, Wasabi, Backblaze B2, MinIO, etc.)
 * Accepts custom endpoints for any S3-compatible provider.
 */
export class StorageService {
  constructor({
    endpoint,
    region = "us-east-1",
    accessKeyId,
    secretAccessKey,
    bucket,
    keyPrefix = "recordings/",
    forcePathStyle = true,
  }) {
    if (!bucket) {
      throw new Error("StorageService requires a bucket name");
    }

    this.bucket = bucket;
    this.keyPrefix = keyPrefix.endsWith("/") ? keyPrefix : `${keyPrefix}/`;
    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials: accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : undefined,
    });
    this.endpoint = endpoint;
    this.region = region;
  }

  /**
   * Upload a recording stream to storage.
   * @param {string} meetingId
   * @param {ReadableStream|Buffer} body
   * @param {object} metadata { contentType, duration, size, format }
   * @returns {Promise<{ key: string, location: string }>}
   */
  async uploadRecording(meetingId, body, metadata = {}) {
    const key = `${this.keyPrefix}${meetingId || "meeting"}/${uuidv4()}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: metadata.contentType || metadata.format || "application/octet-stream",
      Metadata: {
        ...(metadata.duration ? { duration: String(metadata.duration) } : {}),
        ...(metadata.size ? { size: String(metadata.size) } : {}),
        ...(metadata.format ? { format: metadata.format } : {}),
      },
    });

    await this.client.send(command);

    return {
      key,
      location: this.buildObjectUrl(key),
    };
  }

  /**
   * Generate a signed URL for temporary access.
   * @param {string} key
   * @param {number} expiresIn seconds
   */
  async getSignedUrl(key, expiresIn = 3600) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return await getSignedS3Url(this.client, command, { expiresIn });
  }

  /**
   * Delete an object.
   * @param {string} key
   */
  async deleteRecording(key) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }

  /**
   * Construct a public-like URL (not signed). Useful for storing reference.
   * Actual access may still require signing depending on bucket policy.
   */
  buildObjectUrl(key) {
    if (this.endpoint) {
      const trimmed = this.endpoint.endsWith("/") ? this.endpoint.slice(0, -1) : this.endpoint;
      return `${trimmed}/${this.bucket}/${key}`;
    }
    // Fallback to AWS-style URL
    return `https://s3.${this.region}.amazonaws.com/${this.bucket}/${key}`;
  }
}

/**
 * Factory helper to create from calendar storage settings.
 */
export function createStorageFromSettings(settings = {}) {
  if (!settings.storageProvider) return null;
  return new StorageService({
    endpoint: settings.storageEndpoint,
    region: settings.storageRegion || "us-east-1",
    accessKeyId: settings.storageAccessKey,
    secretAccessKey: settings.storageSecretKey,
    bucket: settings.storageBucket,
    forcePathStyle: settings.storageProvider !== "aws_s3",
  });
}

export default StorageService;

