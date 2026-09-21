// Local synthetic media only; no user assets or network requests.
import {spawn} from 'node:child_process';
import {mkdirSync,existsSync,statSync,writeFileSync,appendFileSync} from 'node:fs';
import sharp from 'sharp';
const dir=process.env.AUDIT_MEDIA_DIR??'artifacts/card-battle-performance-optimization/media';mkdirSync(dir,{recursive:true});
const exe=process.env.TEST_FFMPEG_PATH??'ffmpeg';
mkdirSync(`${dir}/frames`,{recursive:true});
for(let i=0;i<30;i++) {
 const path=`${dir}/frames/${String(i).padStart(3,'0')}.png`;
 if(existsSync(path))continue;
 const shapes=Array.from({length:60},(_,j)=>`<circle cx="${(j*131+i*13)%1080}" cy="${(j*173+i*19)%1512}" r="${20+j%70}" fill="hsl(${j*31+i*12},65%,55%)" opacity=".65"/>`).join('');
 await sharp(Buffer.from(`<svg width="1080" height="1512"><rect width="1080" height="1512" fill="#11283c"/>${shapes}</svg>`)).png().toFile(path);
}
const raw=`${dir}/source.rgb`;
if(!existsSync(raw)) {writeFileSync(raw,'');for(let i=0;i<30;i++)appendFileSync(raw,await sharp(`${dir}/frames/${String(i).padStart(3,'0')}.png`).removeAlpha().raw().toBuffer());}
for (const width of [270,1080]) for (const codec of ['h264','vp9']) {
  const path=`${dir}/${width}${codec==='vp9'&&process.env.AUDIT_PROFILE0?'-p0':''}.${codec==='h264'?'mp4':'webm'}`;
  if(existsSync(path)&&statSync(path).size>0)continue;
  const args=['-y','-stream_loop','2','-f','rawvideo','-pixel_format','rgb24','-video_size','1080x1512','-framerate','30','-i',raw,'-t','3','-an','-vf',`scale=${width}:-2:flags=lanczos,fps=30`,...(codec==='h264'?['-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-profile:v','high','-level','4.1','-g','60','-keyint_min','60','-movflags','+faststart']:['-c:v','libvpx-vp9','-crf','24','-b:v','0','-deadline','good','-cpu-used','3','-row-mt','1','-g','60']),'-threads','4',path];
  if(codec==='vp9'&&process.env.AUDIT_PROFILE0)args[args.indexOf('-vf')+1]+=',format=yuv420p';
  await new Promise((resolve,reject)=>{let err='';const p=spawn(exe,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});p.stderr.on('data',d=>err=(err+d).slice(-2000));p.on('error',reject);p.on('close',code=>code?reject(new Error(err)):resolve());});
  console.log(JSON.stringify({width,codec,bytes:statSync(path).size}));
}
