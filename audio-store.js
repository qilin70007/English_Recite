const DATABASE_NAME = "englishRecite.audio.v1";
const DATABASE_VERSION = 1;
const STORE_NAME = "audio";

let databasePromise = null;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("当前设备不支持本机音频存储"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开音频存储"));
  });
  return databasePromise;
}

export async function saveAudio(key, file) {
  const database = await openDatabase();
  const record = {
    key,
    blob: file,
    name: file.name || "朗读音频.mp3",
    type: file.type || "audio/mpeg",
    size: Number(file.size) || 0,
    updatedAt: new Date().toISOString(),
  };
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("音频保存失败"));
    transaction.onabort = () => reject(transaction.error || new Error("音频保存已取消"));
  });
  return {
    name: record.name,
    type: record.type,
    size: record.size,
    updatedAt: record.updatedAt,
  };
}

export async function getAudio(key) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("音频读取失败"));
  });
}

export async function deleteAudio(key) {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("音频删除失败"));
    transaction.onabort = () => reject(transaction.error || new Error("音频删除已取消"));
  });
}

export async function deleteAudios(keys = []) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (!uniqueKeys.length) return;
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    uniqueKeys.forEach((key) => store.delete(key));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("音频删除失败"));
    transaction.onabort = () => reject(transaction.error || new Error("音频删除已取消"));
  });
}
