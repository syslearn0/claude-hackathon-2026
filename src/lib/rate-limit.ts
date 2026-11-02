// 1人あたりの回数制限（API 利用料を守るため）。
// サーバーのメモリにだけ持つので、インスタンスが増えたり再起動したりすると数え直しになる。
// 本当の上限は Claude Console の使用額の上限で掛ける。これはそこに届く前の歯止め。

type Bucket = { count: number; resetAt: number };

export type Limit = { max: number; windowMs: number };

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private perUser: Limit,
    private global: Limit,
    private now: () => number = Date.now,
  ) {}

  // 許可するなら null、断るなら何秒後に試せるかを返す
  check(key: string): { retryAfterSec: number } | null {
    const t = this.now();
    const g = this.hit("__global__", this.global, t);
    const u = this.hit(`u:${key}`, this.perUser, t);
    const blocked = [g, u].filter((b) => b.count > (b === g ? this.global.max : this.perUser.max));
    if (blocked.length === 0) return null;
    // 断った回は数えない
    g.count--;
    u.count--;
    return { retryAfterSec: Math.ceil((Math.max(...blocked.map((b) => b.resetAt)) - t) / 1000) };
  }

  private hit(key: string, limit: Limit, t: number): Bucket {
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      b = { count: 0, resetAt: t + limit.windowMs };
      this.buckets.set(key, b);
    }
    b.count++;
    if (this.buckets.size > 10000) this.sweep(t);
    return b;
  }

  private sweep(t: number) {
    for (const [k, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(k);
  }
}
