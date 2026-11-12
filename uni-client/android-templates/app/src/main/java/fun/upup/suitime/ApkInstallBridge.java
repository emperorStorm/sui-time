package fun.upup.suitime;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.util.Log;
import androidx.core.content.FileProvider;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.UUID;

public final class ApkInstallBridge {
    private ApkInstallBridge() {}

    private static String result(boolean ok, String message, String name, long size) {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", ok);
            result.put("message", message);
            if (name != null) result.put("name", name);
            if (size > 0) result.put("size", size);
        } catch (Exception ignored) {}
        return result.toString();
    }

    private static boolean within(File file, File root) throws IOException {
        return file.getCanonicalPath().startsWith(root.getCanonicalPath() + File.separator);
    }

    private static File target(Context context, String name) throws IOException {
        if (name == null || !name.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.apk")) throw new IOException("更新缓存名称无效");
        File root = new File(context.getFilesDir(), "updates").getCanonicalFile();
        if (!within(root, context.getFilesDir())) throw new IOException("更新目录不可用");
        File file = new File(root, name).getCanonicalFile();
        if (!file.getParentFile().equals(root)) throw new IOException("更新缓存路径无效");
        return file;
    }

    static void validate(File file, long size) throws IOException {
        if (size < 4) throw new IOException("安装包预期大小无效");
        if (!file.isFile()) throw new IOException("安装包文件不存在");
        if (!file.canRead()) throw new IOException("安装包文件不可读");
        if (file.length() != size) throw new IOException("安装包大小不匹配");
        try (FileInputStream input = new FileInputStream(file)) {
            if (input.read() != 0x50 || input.read() != 0x4b) throw new IOException("安装包文件格式无效");
        }
    }

    static void copy(File source, File destination, long size) throws IOException {
        validate(source, size);
        try {
            try (FileInputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(destination)) {
                byte[] buffer = new byte[32768];
                int read;
                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                output.getFD().sync();
            }
            validate(destination, size);
        } catch (IOException error) {
            destination.delete();
            throw error;
        }
    }

    private static void logFile(String stage, File file, long size) {
        Log.i("SuiTimeUpdate", stage + " path=" + file + " expected=" + size
                + " actual=" + file.length() + " exists=" + file.exists()
                + " isFile=" + file.isFile() + " readable=" + file.canRead());
    }

    private static void validatePackage(Context context, File file) throws IOException {
        PackageInfo info = context.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), 0);
        if (info == null || !context.getPackageName().equals(info.packageName)) throw new IOException("安装包与当前应用不匹配");
    }

    public static String stage(Context context, String sourcePath, String directoryPath, String expectedSize) {
        File destination = null;
        try {
            long size = Long.parseLong(expectedSize);
            File directory = new File(directoryPath).getCanonicalFile();
            File source = new File(sourcePath).getCanonicalFile();
            File external = context.getExternalFilesDir(null);
            boolean privateRoot = within(directory, context.getFilesDir().getParentFile())
                    || (external != null && within(directory, external.getParentFile()));
            if (!privateRoot || !"updates".equals(directory.getName()) || !directory.equals(source.getParentFile())) throw new IOException("下载文件不在应用私有更新目录");
            logFile("stage/source", source, size);
            validate(source, size);
            String name = UUID.randomUUID().toString() + ".apk";
            destination = target(context, name);
            File root = destination.getParentFile();
            if (!root.isDirectory() && !root.mkdirs()) throw new IOException("无法创建私有更新目录");
            copy(source, destination, size);
            logFile("stage/target", destination, size);
            validatePackage(context, destination);
            return result(true, "", name, size);
        } catch (Exception error) {
            Log.e("SuiTimeUpdate", "stage failed", error);
            if (destination != null) destination.delete();
            return result(false, error.getMessage() == null ? "无法读取或保存下载的安装包" : error.getMessage(), null, 0);
        }
    }

    public static String inspect(Context context, String name, String expectedSize) {
        try {
            long size = Long.parseLong(expectedSize);
            File file = target(context, name);
            logFile("inspect", file, size);
            validate(file, size);
            validatePackage(context, file);
            return result(true, "", name, size);
        } catch (Exception error) {
            return result(false, error.getMessage() == null ? "安装包缓存不可用" : error.getMessage(), null, 0);
        }
    }

    public static String install(Context context, String name, String expectedSize) {
        try {
            File file = target(context, name);
            long size = Long.parseLong(expectedSize);
            logFile("install", file, size);
            validate(file, size);
            validatePackage(context, file);
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".updates.fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return result(true, "", null, 0);
        } catch (Exception error) {
            return result(false, error.getMessage() == null ? "无法打开系统安装界面" : error.getMessage(), null, 0);
        }
    }

    public static String remove(Context context, String name) {
        try {
            File file = target(context, name);
            if (file.exists() && !file.delete()) throw new IOException("无法清理更新缓存");
            return result(true, "", null, 0);
        } catch (Exception error) {
            return result(false, error.getMessage() == null ? "无法清理更新缓存" : error.getMessage(), null, 0);
        }
    }
}
