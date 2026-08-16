#!/usr/bin/env node
/**
 * 安装包一键上传阿里云 OSS（国内加速镜像）
 *
 * 无第三方依赖，Node 18+ 直接运行。使用 OSS V1 签名（HMAC-SHA1）。
 *
 * 用法：
 *   export OSS_ACCESS_KEY_ID=xxx
 *   export OSS_ACCESS_KEY_SECRET=xxx
 *   export OSS_BUCKET=dsh-download
 *   export OSS_REGION=oss-cn-hangzhou        # 可选，默认 oss-cn-hangzhou
 *   node tools/oss-upload.mjs file1.exe file2.dmg ...
 */
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import { basename, extname } from 'node:path';

const {
  OSS_ACCESS_KEY_ID,
  OSS_ACCESS_KEY_SECRET,
  OSS_BUCKET,
  OSS_REGION = 'oss-cn-hangzhou',
} = process.env;

if (!OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET || !OSS_BUCKET) {
  console.error(
    '缺少环境变量。请先设置：\n' +
    '  export OSS_ACCESS_KEY_ID=xxx\n' +
    '  export OSS_ACCESS_KEY_SECRET=xxx\n' +
    '  export OSS_BUCKET=dsh-download\n' +
    '  export OSS_REGION=oss-cn-hangzhou   # 可选\n'
  );
  process.exit(1);
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法：node tools/oss-upload.mjs <文件1> <文件2> ...');
  process.exit(1);
}

const MIME = {
  '.exe': 'application/x-msdownload',
  '.dmg': 'application/x-apple-diskimage',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.html': 'text/html; charset=utf-8',
};

/** 上传单个文件，返回公开 URL */
async function putObject(file) {
  const key = basename(file);
  const size = statSync(file).size;
  const contentType = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  const date = new Date().toUTCString();
  const resource = `/${OSS_BUCKET}/${key}`;

  // OSS V1 签名串：VERB + "\n" + Content-MD5 + "\n" + Content-Type + "\n" + Date + "\n" + OSSHeaders + Resource
  const stringToSign = ['PUT', '', contentType, date, '', resource].join('\n');
  const signature = createHmac('sha1', OSS_ACCESS_KEY_SECRET)
    .update(stringToSign)
    .digest('base64');

  const url = `https://${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com/${key}`;
  const body = Readable.toWeb(createReadStream(file));

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Date: date,
      'Content-Type': contentType,
      'Content-Length': String(size),
      Authorization: `OSS ${OSS_ACCESS_KEY_ID}:${signature}`,
    },
    body,
    duplex: 'half',
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}\n${(await res.text()).slice(0, 500)}`);
  }
  return url;
}

let okCount = 0;
for (const f of files) {
  const mb = (statSync(f).size / 1024 / 1024).toFixed(1);
  process.stdout.write(`↑ ${basename(f)} (${mb} MB) ... `);
  try {
    const url = await putObject(f);
    console.log(`✔ ${url}`);
    okCount++;
  } catch (e) {
    console.error(`✘ ${e.message}`);
    process.exitCode = 1;
  }
}
console.log(`\n完成：${okCount}/${files.length} 上传成功。`);
console.log('把 Bucket 根 URL（去掉文件名）填入 index.html 的 CFG.mirrorBase 即可。');
