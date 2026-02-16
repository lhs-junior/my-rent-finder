import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { withDbClient } from "./db_client.mjs";

const DEFAULT_IMAGE_DIR = "data/images";

/**
 * Process queued image fetch jobs.
 * Downloads primary image for each listing.
 * @param {Object} options - { imageDir, concurrency, limit }
 */
export async function processImageJobs(options = {}) {
  const imageDir = options.imageDir || DEFAULT_IMAGE_DIR;
  const limit = options.limit || 50;

  // Ensure image directory exists
  fs.mkdirSync(imageDir, { recursive: true });

  const results = { processed: 0, downloaded: 0, failed: 0, skipped: 0 };

  await withDbClient(async (client) => {
    // Get queued jobs
    const jobs = await client.query(
      `SELECT j.image_job_id, j.listing_id, i.source_url, i.image_id
       FROM image_fetch_jobs j
       JOIN listing_images i ON i.listing_id = j.listing_id AND i.is_primary = true
       WHERE j.status = 'queued'
       ORDER BY j.requested_at ASC
       LIMIT $1`,
      [limit]
    );

    for (const job of jobs.rows) {
      results.processed++;

      // Mark as running
      await client.query(
        `UPDATE image_fetch_jobs SET status = 'running', started_at = NOW() WHERE image_job_id = $1`,
        [job.image_job_id]
      );

      try {
        // Check for duplicate URL
        const existing = await client.query(
          `SELECT local_path FROM listing_images WHERE source_url = $1 AND status = 'downloaded'`,
          [job.source_url]
        );

        if (existing.rows.length > 0) {
          results.skipped++;
          await client.query(
            `UPDATE image_fetch_jobs SET status = 'skipped', finished_at = NOW() WHERE image_job_id = $1`,
            [job.image_job_id]
          );
          continue;
        }

        // Download image
        const filename = `${job.listing_id}_${job.image_id}.jpg`;
        const localPath = path.join(imageDir, filename);
        await downloadFile(job.source_url, localPath);

        // Update listing_images
        const stats = fs.statSync(localPath);
        await client.query(
          `UPDATE listing_images SET status = 'downloaded', local_path = $1, file_size_bytes = $2, downloaded_at = NOW() WHERE image_id = $3`,
          [localPath, stats.size, job.image_id]
        );

        // Mark job done
        await client.query(
          `UPDATE image_fetch_jobs SET status = 'done', finished_at = NOW() WHERE image_job_id = $1`,
          [job.image_job_id]
        );

        results.downloaded++;
      } catch (err) {
        results.failed++;
        await client.query(
          `UPDATE image_fetch_jobs SET status = 'failed', finished_at = NOW(), failure_reason = $1 WHERE image_job_id = $2`,
          [String(err?.message || err).slice(0, 500), job.image_job_id]
        );
      }
    }
  });

  return results;
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, { timeout: 15000 }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(response.headers.location, destPath).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        return reject(new Error(`HTTP ${response.statusCode}`));
      }
      response.pipe(file);
      file.on("finish", () => { file.close(resolve); });
      file.on("error", reject);
    }).on("error", (err) => {
      file.close();
      try { fs.unlinkSync(destPath); } catch {}
      reject(err);
    });
  });
}
