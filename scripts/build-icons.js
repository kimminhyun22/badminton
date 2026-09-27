'use strict';
// Run with Sharp available in Node's module path.
const sharp=require('sharp'),path=require('path');
const root=path.resolve(__dirname,'..');
(async()=>{
  for(const [name,size] of [['icon-192.png',192],['icon-512.png',512],['apple-touch-icon.png',180],['favicon-32.png',32]]){
    await sharp(path.join(root,'icon-source.svg')).resize(size,size).png().toFile(path.join(root,name));
    console.log(name+' '+size+'x'+size);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
