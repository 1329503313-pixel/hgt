export type StickerAsset = {
  id: string;
  name: string;
  text: string;
  staticUrl: string;
  animatedUrl: string;
  width: number;
  height: number;
};

export type StickerSeries = {
  id: string;
  name: string;
  characterName: string;
  stickers: StickerAsset[];
};

export const stickerSeries: StickerSeries[] = [
  {
    id: "tangtang-detective",
    name: "汤汤侦探",
    characterName: "汤汤",
    stickers: [
      {
        id: "tangtang-detective-hello",
        name: "你好呀",
        text: "你好呀",
        staticUrl: "/stickers/tangtang-detective/hello/TTZT_01_你好呀_V1_static.webp",
        animatedUrl: "/stickers/tangtang-detective/hello/TTZT_01_你好呀_V1_320.webp",
        width: 320,
        height: 320
      },
      {
        id: "tangtang-detective-come-drink-soup",
        name: "来喝汤",
        text: "来喝汤",
        staticUrl: "/stickers/tangtang-detective/come-drink-soup/TTZT_02_来喝汤_V1_static.webp",
        animatedUrl: "/stickers/tangtang-detective/come-drink-soup/TTZT_02_来喝汤_V1_320.webp",
        width: 320,
        height: 320
      },
      {
        id: "tangtang-detective-received",
        name: "收到啦",
        text: "收到啦",
        staticUrl: "/stickers/tangtang-detective/received/TTZT_03_收到啦_V1_static.webp",
        animatedUrl: "/stickers/tangtang-detective/received/TTZT_03_收到啦_V1_320.webp",
        width: 320,
        height: 320
      },
      {
        id: "tangtang-detective-good-night",
        name: "晚安喔",
        text: "晚安喔",
        staticUrl: "/stickers/tangtang-detective/good-night/TTZT_04_晚安喔_V1_static.webp",
        animatedUrl: "/stickers/tangtang-detective/good-night/TTZT_04_晚安喔_V1_320.webp",
        width: 320,
        height: 320
      },
      {
        id: "tangtang-detective-question",
        name: "我有问题",
        text: "我有问题",
        staticUrl: "/stickers/tangtang-detective/question/TTZT_05_我有问题_V1_static.webp",
        animatedUrl: "/stickers/tangtang-detective/question/TTZT_05_我有问题_V1_320.webp",
        width: 320,
        height: 320
      },
      {
        id: "tangtang-detective-is-that-so",
        name: "是这样吗",
        text: "是这样吗",
        staticUrl: "/stickers/tangtang-detective/is-that-so/TTZT_06_是这样吗_V1_static.webp",
        animatedUrl: "/stickers/tangtang-detective/is-that-so/TTZT_06_是这样吗_V1_320.webp",
        width: 320,
        height: 320
      },
      {
        id: "tangtang-detective-think-again",
        name: "再想想看",
        text: "再想想看",
        staticUrl: "/stickers/tangtang-detective/think-again/TTZT_07_再想想看_V1_static.webp",
        animatedUrl: "/stickers/tangtang-detective/think-again/TTZT_07_再想想看_V1_320.webp",
        width: 320,
        height: 320
      },
      {
        id: "tangtang-detective-clue",
        name: "线索呢",
        text: "线索呢",
        staticUrl: "/stickers/tangtang-detective/clue/TTZT_08_线索呢_V1_static.webp",
        animatedUrl: "/stickers/tangtang-detective/clue/TTZT_08_线索呢_V1_320.webp",
        width: 320,
        height: 320
      },
      {
        id: "tangtang-detective-brain-burning",
        name: "好烧脑呀",
        text: "好烧脑呀",
        staticUrl: "/stickers/tangtang-detective/brain-burning/TTZT_09_好烧脑呀_V1_static.webp",
        animatedUrl: "/stickers/tangtang-detective/brain-burning/TTZT_09_好烧脑呀_V1_320.webp",
        width: 320,
        height: 320
      },
      {
        id: "tangtang-detective-confused",
        name: "我懵了",
        text: "我懵了",
        staticUrl: "/stickers/tangtang-detective/confused/TTZT_10_我懵了_V1_static.webp",
        animatedUrl: "/stickers/tangtang-detective/confused/TTZT_10_我懵了_V1_320.webp",
        width: 320,
        height: 320
      }
    ]
  }
];

const stickersById = new Map(
  stickerSeries.flatMap((series) => series.stickers.map((sticker) => [sticker.id, sticker] as const))
);

export function getSticker(stickerId: string) {
  return stickersById.get(stickerId) ?? null;
}
