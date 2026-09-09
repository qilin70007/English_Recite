// Android's document picker receives the real MIME type and binary bytes.
// Only one 64 KB slice crosses the JS bridge at a time, including large backups.
export async function downloadFile(blob, filename, onProgress = () => {}) {
  const safeName = filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-");
  const native = window.AndroidFiles;
  if (native?.beginFile && native?.appendFile && native?.finishFile) {
    const token = native.beginFile(safeName, blob.type || "application/octet-stream");
    if (!token) throw new Error("另一个文件正在保存，请完成后重试。");
    try {
      for (let offset = 0; offset < blob.size; offset += 65536) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + 65536).arrayBuffer());
        let binary = "";
        for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
        if (!native.appendFile(token, btoa(binary))) throw new Error("文件准备失败，请检查手机剩余空间。");
        onProgress(`正在准备保存 ${Math.min(100, Math.round((offset + bytes.length) / blob.size * 100))}%…`);
      }
      return await new Promise((resolve, reject) => {
        const completed = (event) => {
          if (event.detail?.id !== token) return;
          window.removeEventListener("native-file-saved", completed);
          if (event.detail.status === "saved") resolve(true);
          else if (event.detail.status === "cancelled") resolve(false);
          else reject(new Error("文件保存失败，请检查保存位置或剩余空间。"));
        };
        window.addEventListener("native-file-saved", completed);
        if (!native.finishFile(token)) {
          window.removeEventListener("native-file-saved", completed);
          reject(new Error("无法打开保存位置，请重试。"));
        }
      });
    } catch (error) {
      native.cancelFile?.(token);
      throw error;
    }
  }
  if (native) throw new Error("请安装新版 APK 后再导出 Word 或包含音频的备份。");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}
