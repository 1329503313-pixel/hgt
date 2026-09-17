import test from "node:test";
import assert from "node:assert/strict";
import { VoiceMicrophone } from "../src/shared/voiceMicrophone";
function fixture() { const track = { enabled: true, readyState: "live", stop() { this.readyState = "ended"; } }; const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream; return { track, stream }; }
function deferred<T>() { let resolve!: (value: T)=>void; const promise = new Promise<T>(r=>resolve=r); return { promise, resolve }; }
test("release before permission resolves never publishes and stops the late track", async () => {
  const mic = new VoiceMicrophone(); const f = fixture(); const capture = deferred<MediaStream>(); let publishes=0;
  const start=mic.start(()=>capture.promise,async()=>{publishes++},()=>true); mic.stop(); capture.resolve(f.stream);
  assert.equal(await start,false); assert.equal(publishes,0); assert.equal(f.track.readyState,"ended");
});
test("backgrounding during SDK publication disables track before the SDK resolves", async () => {
  const mic=new VoiceMicrophone(); const f=fixture(); const published=deferred<void>();
  const start=mic.start(async()=>f.stream,()=>published.promise,()=>true); await Promise.resolve();
  assert.equal(f.track.enabled,false); mic.stop(); assert.equal(f.track.readyState,"ended"); published.resolve(); assert.equal(await start,false);
});
test("only an authorized completed publication opens the microphone", async () => {
  const mic=new VoiceMicrophone(); const f=fixture();
  assert.equal(await mic.start(async()=>f.stream,async()=>{},()=>true),true); assert.equal(mic.active,true);
  mic.stop(); assert.equal(mic.active,false); assert.equal(f.track.enabled,false);
});
test("revoked permission and publishing failures release captured devices", async () => {
  const mic=new VoiceMicrophone(); const first=fixture(); assert.equal(await mic.start(async()=>first.stream,async()=>{},()=>false),false); assert.equal(first.track.readyState,"ended");
  const second=fixture(); await assert.rejects(mic.start(async()=>second.stream,async()=>{throw Error('offline')},()=>true)); assert.equal(second.track.readyState,"ended"); assert.equal(mic.active,false);
});
test("device removal during publication cannot produce a false speaking state", async () => {
  const mic = new VoiceMicrophone(); const f = fixture();
  assert.equal(await mic.start(async()=>f.stream, async()=>{f.track.stop()},()=>true),false);
  assert.equal(mic.active,false);
});
