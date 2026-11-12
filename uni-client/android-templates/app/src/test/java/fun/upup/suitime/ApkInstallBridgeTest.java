package fun.upup.suitime;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import static org.junit.Assert.*;

public class ApkInstallBridgeTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    private File apk() throws IOException {
        File file = temporary.newFile();
        Files.write(file.toPath(), new byte[] {0x50, 0x4b, 3, 4});
        return file;
    }

    @Test public void rejectsInvalidExpectedSize() throws Exception {
        IOException error = assertThrows(IOException.class, () -> ApkInstallBridge.validate(apk(), 0));
        assertEquals("安装包预期大小无效", error.getMessage());
    }

    @Test public void distinguishesMissingFileAndDirectory() throws Exception {
        File missing = new File(temporary.getRoot(), "missing.apk");
        assertEquals("安装包文件不存在", assertThrows(IOException.class,
                () -> ApkInstallBridge.validate(missing, 4)).getMessage());
        assertThrows(IOException.class, () -> ApkInstallBridge.validate(temporary.getRoot(), 4));
    }

    @Test public void rejectsUnreadableFile() throws Exception {
        File unreadable = new File(temporary.getRoot(), "unreadable.apk") {
            @Override public boolean isFile() { return true; }
            @Override public boolean canRead() { return false; }
        };
        assertEquals("安装包文件不可读", assertThrows(IOException.class,
                () -> ApkInstallBridge.validate(unreadable, 4)).getMessage());
    }

    @Test public void rejectsTruncatedAndInvalidFiles() throws Exception {
        File source = apk();
        assertEquals("安装包大小不匹配", assertThrows(IOException.class,
                () -> ApkInstallBridge.validate(source, 8)).getMessage());
        Files.write(source.toPath(), new byte[] {1, 2, 3, 4});
        assertEquals("安装包文件格式无效", assertThrows(IOException.class,
                () -> ApkInstallBridge.validate(source, 4)).getMessage());
    }

    @Test public void copiesAndValidatesActualBytes() throws Exception {
        File source = apk();
        File destination = new File(temporary.getRoot(), "target.apk");
        ApkInstallBridge.copy(source, destination, 4);
        assertArrayEquals(Files.readAllBytes(source.toPath()), Files.readAllBytes(destination.toPath()));
        ApkInstallBridge.validate(destination, 4);
    }

    @Test public void rejectsSourceBeforeWritingDestination() throws Exception {
        File source = apk();
        File destination = new File(temporary.getRoot(), "target.apk");
        assertThrows(IOException.class, () -> ApkInstallBridge.copy(source, destination, 8));
        assertFalse(destination.exists());
    }

    @Test public void removesDestinationWhenPostCopyValidationFails() throws Exception {
        File source = apk();
        File destination = new File(temporary.getRoot(), "target.apk") {
            @Override public long length() { return 0; }
        };
        assertThrows(IOException.class, () -> ApkInstallBridge.copy(source, destination, 4));
        assertFalse(destination.exists());
        assertTrue(source.exists());
    }
}
