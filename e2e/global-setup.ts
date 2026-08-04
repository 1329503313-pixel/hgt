import mysql from "mysql2/promise";

// Keep seed media in the server's canonical format so startup migrations do not
// spend time re-encoding every fixture (or depend on PNG decoder differences).
const fixtureImage = "data:image/webp;base64,UklGRjgAAABXRUJQVlA4ICwAAABwAQCdASoCAAIAAUAmJaACdAF1AAD+4uC/9pZ//2ln//aWf48uuLmyG8AAAA==";

export default async function globalSetup() {
  const database = process.env.DB_NAME || "";
  if (!/^[A-Za-z0-9_]+_e2e$/.test(database)) throw new Error("拒绝向非 E2E 数据库写入测试种子");
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "hgt",
    password: process.env.DB_PASSWORD || "hgt_password",
    database
  });
  try {
    const rewardGifts = [
      ["e2e-gift-pillow", "汤汤抱枕", "daily:tangtang_pillow"],
      ["e2e-gift-shell", "幸运贝壳", "daily:lucky_shell"],
      ["e2e-gift-key", "神秘钥匙", "ranking:mystery_key"],
      ["e2e-gift-crystal", "智慧水晶球", "ranking:wisdom_crystal"],
      ["e2e-gift-boat", "月亮小船", "ranking:moon_boat"],
      ["e2e-gift-pearl", "深海明珠", "ranking:deep_sea_pearl"]
    ];
    for (const [id, name, rewardKey] of rewardGifts) {
      await connection.query(
        `INSERT INTO gifts
         (id, name, description, icon_image, payment_currency, cost_amount,
          reward_shell, reward_pearl, reward_charm, status, sort_order)
         VALUES (?, ?, '自动化回归测试礼物', ?, 'shell', 1, 0, 0, 1, 'active', 0)`,
        [id, name, fixtureImage]
      );
      await connection.query(
        "INSERT INTO system_reward_gift_bindings (reward_key, gift_id, expected_name) VALUES (?, ?, ?)",
        [rewardKey, id, name]
      );
    }

    const cards = [
      ["e2e-card-normal", "E2E-N-001", "回归普通卡", "normal"],
      ["e2e-card-rare", "E2E-R-001", "回归稀有卡", "rare"],
      ["e2e-card-epic", "E2E-E-001", "回归史诗卡", "epic"],
      ["e2e-card-legend", "E2E-L-001", "回归传说卡", "legend"]
    ];
    for (const [id, cardNo, name, rarity] of cards) {
      await connection.query(
        `INSERT INTO asset_cards (id, card_no, name, rarity, image_url, thumbnail_url, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [id, cardNo, name, rarity, fixtureImage, fixtureImage]
      );
    }
    await connection.query(
      `INSERT INTO asset_packs
       (id, name, cover_url, cover_thumbnail, description, pack_story, pack_type,
        single_price, ten_price, daily_free_draws, enabled, sort_order, probability_notice)
       VALUES ('e2e-pack', '核心回归卡包', ?, ?, '用于自动化回归测试', '测试卡包故事',
        'permanent', 10, 90, 3, 1, 999, '自动化测试概率')`,
      [fixtureImage, fixtureImage]
    );
    const probabilities: Record<string, number> = { normal: 70, rare: 20, epic: 9, legend: 1 };
    for (const [id, , , rarity] of cards) {
      await connection.query(
        "INSERT INTO asset_pack_cards (pack_id, card_id, probability, enabled) VALUES ('e2e-pack', ?, ?, 1)",
        [id, probabilities[rarity]]
      );
    }
    for (const [rarity, probability] of Object.entries(probabilities)) {
      await connection.query(
        "INSERT INTO asset_pack_rarity_probabilities (pack_id, rarity, probability) VALUES ('e2e-pack', ?, ?)",
        [rarity, probability]
      );
    }
  } finally {
    await connection.end();
  }
}
