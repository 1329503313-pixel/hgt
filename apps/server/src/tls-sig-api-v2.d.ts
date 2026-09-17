declare module "tls-sig-api-v2" {
  export class Api {
    constructor(sdkAppId: number, secret: string);
    genUserSig(userId: string, expire: number): string;
    genPrivateMapKeyWithStringRoomID(userId: string, expire: number, roomId: string, privileges: number): string;
  }
}
