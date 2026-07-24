// 百度搜索资源平台 — 普通收录 API 推送
// 文档：https://ziyuan.baidu.com/linksubmit/index
// API 地址 + token 来自百度站长平台站点配置

const BAIDU_PUSH_URL =
  "http://data.zz.baidu.com/urls?site=https://hgt.caqis.com&token=VkGXAnCpqSun48yp";

async function postBaidu(urls: string[]): Promise<{ success: number; remain: number }> {
  const body = urls.join("\n");
  const res = await fetch(BAIDU_PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body
  });
  if (!res.ok) {
    throw new Error(`百度推送 HTTP ${res.status}: ${await res.text().catch(() => "")}`.slice(0, 200));
  }
  const data = (await res.json()) as {
    success?: number;
    remain?: number;
    error?: string;
  };
  if (data.error) {
    throw new Error(`百度推送错误: ${data.error}`);
  }
  console.log(
    `[百度推送] 推送 ${urls.length} 条 → 成功 ${data.success ?? 0}，剩余配额 ${data.remain ?? "?"}`
  );
  return { success: data.success ?? 0, remain: data.remain ?? 0 };
}

/** 单条/批量推送指定 URL */
export async function pushUrlsToBaidu(urls: string[]) {
  if (urls.length === 0) return { success: 0, remain: 0 };
  try {
    return await postBaidu(urls);
  } catch (err) {
    console.error("[百度推送] 推送失败:", err instanceof Error ? err.message : err);
    return { success: 0, remain: 0 };
  }
}

/** 海龟汤创建或审核通过后立即推送单条链接 */
export async function pushSoupUrl(soupId: string, siteUrl: string) {
  const canonical = `${siteUrl.replace(/\/+$/, "")}/soup/${encodeURIComponent(soupId)}`;
  console.log(`[百度推送] 新汤面即时推送: ${canonical}`);
  return pushUrlsToBaidu([canonical]);
}

/** 收集全站 SEO 可见 URL 列表 */
async function collectSiteUrls(
  pool: import("mysql2/promise").Pool,
  siteUrl: string
): Promise<string[]> {
  const base = siteUrl.replace(/\/+$/, "");
  const urls: string[] = [];

  // 首页
  urls.push(`${base}/`);
  // 排行榜
  urls.push(`${base}/mine/rankings`);
  // 优秀作者
  urls.push(`${base}/mine/excellent-author`);

  // 所有公开+已审核的海龟汤
  const [soups] = await pool.query<import("mysql2/promise").RowDataPacket[]>(
    `SELECT id FROM soups
     WHERE is_surface_public = TRUE AND review_status = 'approved'
     ORDER BY created_at DESC
     LIMIT 49997`
  );
  for (const row of soups) {
    urls.push(`${base}/soup/${encodeURIComponent(String(row.id))}`);
  }

  // 活跃用户主页（最近 1 个月有活动的，最多 1000 条）
  const [users] = await pool.query<import("mysql2/promise").RowDataPacket[]>(
    `SELECT id FROM users
     WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 MONTH)
     ORDER BY created_at DESC
     LIMIT 1000`
  );
  for (const row of users) {
    urls.push(`${base}/users/${encodeURIComponent(String(row.id))}`);
  }

  return urls;
}

/** 全站推送（定时任务用）：收集所有公开页面 URL 批量提交百度 */
export async function pushFullSiteToBaidu(
  pool: import("mysql2/promise").Pool,
  siteUrl: string
) {
  try {
    const urls = await collectSiteUrls(pool, siteUrl);
    console.log(`[百度推送] 全量推送开始，共 ${urls.length} 条`);
    // 百度 API 单次不限量，但分批 2000 条以防超时
    const BATCH = 2000;
    let totalSuccess = 0;
    for (let i = 0; i < urls.length; i += BATCH) {
      const batch = urls.slice(i, i + BATCH);
      const { success } = await pushUrlsToBaidu(batch);
      totalSuccess += success;
    }
    console.log(`[百度推送] 全量推送完成，成功 ${totalSuccess}/${urls.length}`);
  } catch (err) {
    console.error("[百度推送] 全量推送失败:", err instanceof Error ? err.message : err);
  }
}
