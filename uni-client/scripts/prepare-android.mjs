// 组装 uni-app 安卓离线打包工程：
//   android-templates/（仓库内模板） + SDK 核心 aar + uni-app 构建产物 → android/（可被 gradle 直接构建）
// 用法：
//   node scripts/prepare-android.mjs --sdk <SDK zip 或解压目录> --www <dist/build/app> \
//     --appkey <DCloud 离线打包Key> [--versionName 0.4.0] [--versionCode 400] [--out android]
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UNI_ROOT = path.resolve(__dirname, '..');
const TEMPLATES = path.join(UNI_ROOT, 'android-templates');
const DEFAULT_OUT = path.join(UNI_ROOT, 'android');
const SDK_CACHE = path.join(UNI_ROOT, '.android-sdk-cache');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i]] = argv[i + 1];
  return args;
}

async function ensureSdkDir(sdkArg) {
  if (!sdkArg) throw new Error('缺少 --sdk 参数：SDK zip 路径或已解压目录');
  if (!sdkArg.endsWith('.zip')) {
    // 已解压目录：定位包含 simpleDemo 的 HBuilder-Integrate-AS
    const integrate = path.join(sdkArg, 'HBuilder-Integrate-AS');
    if (fs.stat(integrate).then(() => true, () => false)) return integrate;
    return sdkArg;
  }
  await fs.mkdir(SDK_CACHE, { recursive: true });
  const dir = path.join(SDK_CACHE, 'sdk');
  const marker = path.join(dir, 'HBuilder-Integrate-AS');
  if (!(await fs.stat(marker).then(() => true, () => false))) {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    execSync(`unzip -q -o "${sdkArg}" -d "${dir}"`, { stdio: 'inherit' });
  }
  const top = (await fs.readdir(dir)).find((n) => n.startsWith('Android-SDK@'));
  return path.join(dir, top || '', 'HBuilder-Integrate-AS');
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = path.resolve(args['--out'] || DEFAULT_OUT);
  const www = args['--www'];
  const appkey = args['--appkey'];
  if (!www || !appkey) throw new Error('需要 --www 与 --appkey 参数');

  // 版本号默认从 src/manifest.json 读取
  let versionName = args['--versionName'];
  let versionCode = args['--versionCode'];
  if (!versionName || !versionCode) {
    const manifest = JSON.parse(await fs.readFile(path.join(UNI_ROOT, 'src', 'manifest.json'), 'utf8'));
    versionName = versionName || manifest.versionName;
    versionCode = versionCode || manifest.versionCode;
  }

  console.log('==> 1/5 定位 SDK（aar 运行库）…');
  const integrate = await ensureSdkDir(args['--sdk']);
  const demoLibs = path.join(integrate, 'simpleDemo', 'libs');

  console.log('==> 2/5 从模板生成 android 工程:', out);
  await fs.rm(out, { recursive: true, force: true });
  await copyDir(TEMPLATES, out);

  console.log('==> 3/5 复制核心 aar 到 app/libs…');
  await fs.mkdir(path.join(out, 'app', 'libs'), { recursive: true });
  for (const f of await fs.readdir(demoLibs)) {
    if (f.endsWith('.aar') || f.endsWith('.jar')) {
      await fs.copyFile(path.join(demoLibs, f), path.join(out, 'app', 'libs', f));
    }
  }

  console.log('==> 4/5 注入 uni-app www 资源…');
  const wwwDest = path.join(out, 'app', 'src', 'main', 'assets', 'apps', '__UNI__DACC2E3', 'www');
  await copyDir(www, wwwDest);

  console.log('==> 5/5 渲染模板（appkey/版本/签名）…');
  const render = async (template, target, subs) => {
    let text = await fs.readFile(template, 'utf8');
    for (const [k, v] of Object.entries(subs)) text = text.split(k).join(v);
    await fs.writeFile(target, text);
  };
  await render(
    path.join(out, 'app', 'src', 'main', 'AndroidManifest.template.xml'),
    path.join(out, 'app', 'src', 'main', 'AndroidManifest.xml'),
    { __DCLOUD_APPKEY__: appkey },
  );
  await render(
    path.join(out, 'app', 'src', 'main', 'assets', 'data', 'dcloud_control.template.xml'),
    path.join(out, 'app', 'src', 'main', 'assets', 'data', 'dcloud_control.xml'),
    { __APP_VERSION__: versionName },
  );
  await fs.unlink(path.join(out, 'app', 'src', 'main', 'AndroidManifest.template.xml'));
  await fs.unlink(path.join(out, 'app', 'src', 'main', 'assets', 'data', 'dcloud_control.template.xml'));

  // 本地构建定位 Android SDK
  const androidHome = process.env.ANDROID_HOME || path.join(process.env.HOME || '', 'Library', 'Android', 'sdk');
  await fs.writeFile(path.join(out, 'local.properties'), `sdk.dir=${androidHome.replace(/\\/g, '\\\\')}\n`);

  // 从 BASE64 还原 keystore（CI 场景）
  if (process.env.ANDROID_KEYSTORE_BASE64) {
    await fs.writeFile(
      path.join(out, 'app', 'keystore.jks'),
      Buffer.from(process.env.ANDROID_KEYSTORE_BASE64, 'base64'),
    );
  }

  console.log(`==> 完成。versionName=${versionName} versionCode=${versionCode}，执行 gradle 构建即可。`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
