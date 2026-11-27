import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fileName } from "./filePaths";

type Preview = { url: string } | { error: string };

export default function ImagePreview({ path, mediaType, source }: {
  path: string;
  mediaType: string;
  source?: string;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let url: string | undefined;

    async function load() {
      try {
        const data = source ?? await invoke<ArrayBuffer | number[]>("read_image", { path });
        if (disposed) return;
        const image = Array.isArray(data) ? Uint8Array.from(data) : data;
        url = URL.createObjectURL(new Blob([image], { type: mediaType }));
        setPreview({ url });
      } catch (error) {
        if (!disposed) setPreview({ error: error instanceof Error ? error.message : String(error) });
      }
    }

    void load();
    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, mediaType, source, attempt]);

  if (!preview) return <p className="file-message" role="status">Loading image…</p>;
  if ("error" in preview) return (
    <div className="file-error">
      <div role="alert">
        <strong>Image could not be opened</strong>
        <p>{preview.error}</p>
      </div>
      <button type="button" onClick={() => {
        setPreview(null);
        setAttempt((previous) => previous + 1);
      }}>Retry preview</button>
    </div>
  );

  return (
    <div className="image-preview">
      <img
        src={preview.url}
        alt={fileName(path)}
        onError={() => setPreview({ error: "The image is damaged or uses an unsupported format." })}
      />
    </div>
  );
}
