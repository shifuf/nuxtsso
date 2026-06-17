import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface Bucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();

  consume(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const current = this.buckets.get(key);

    if (!current || current.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }

    current.count += 1;
    if (current.count > limit) {
      throw new HttpException('请求过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
