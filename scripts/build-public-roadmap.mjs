import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(scriptDir,'..');
const docsDir=path.join(root,'docs','public-rollout');
const dataPath=path.join(docsDir,'roadmap.json');
const templatePath=path.join(docsDir,'roadmap.template.html');
const outputPath=path.join(docsDir,'ROADMAP.html');

const data=JSON.parse(fs.readFileSync(dataPath,'utf8'));
const template=fs.readFileSync(templatePath,'utf8');
const serialized=JSON.stringify(data).replaceAll('<','\\u003c');
const output=template.replace('__ROADMAP_DATA__',serialized);

if(output===template)throw new Error('roadmap template placeholder not found');
fs.writeFileSync(outputPath,output);
console.log(`built ${path.relative(root,outputPath)} (${data.updated})`);
