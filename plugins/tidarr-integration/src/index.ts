import { Tracer, type LunaUnload, ReactiveStore, ftch } from "@luna/core";
import { ContextMenu } from "@luna/lib";

export const { errSignal, trace } = Tracer("[tidarr-integration]");
export const unloads = new Set<LunaUnload>();
export { Settings } from "./Settings";

// flexing type safety, because why not
interface TidalArtist {
  id: number;
  name: string;
  type: string;
  picture: string | null;
  handle: string | null;
  userId: number | null;
}

interface TidalAlbum {
  id: number;
  title: string;
  cover: string;
  vibrantColor: string | null;
  videoCover: string | null;
  url: string;
  releaseDate: string;
}

interface TidalItem {
  id: number;
  title: string;
  duration: number;
  version: string | null;
  url: string;
  artists: TidalArtist[];
  album: TidalAlbum | null;
  explicit: boolean;
  volumeNumber: number;
  trackNumber: number;
  popularity: number;
  doublePopularity: number;
  allowStreaming: boolean;
  streamReady: boolean;
  streamStartDate: string;
  adSupportedStreamReady: boolean;
  djReady: boolean;
  stemReady: boolean;
  editable: boolean;
  replayGain: number;
  audioQuality: string;
  audioModes: string[];
  mixes: Record<string, string>;
  mediaMetadata: {
    tags: string[];
  };
  upload: boolean;
  payToStream: boolean;
  accessType: string;
  spotlighted: boolean;
  contentType: string;
}

interface PluginSettings {
  tidarrUrl: string;
  adminPassword: string;
  downloadQuality: string;
  debugMode: boolean;
}

interface TidarrAuthResponse {
  accessGranted: boolean;
  token: string;
}

interface TidarrItem {
  id: string;
  title: string;
  artist: string;
  type: "track" | "album";
  quality: string;
  status: string;
  loading: boolean;
  error: boolean;
  url: string;
}

async function getSettings(): Promise<PluginSettings> {
  return await ReactiveStore.getPluginStorage<PluginSettings>("tidarr-integration", {
    tidarrUrl: "",
    adminPassword: "",
    downloadQuality: "high",
    debugMode: false,
  });
}

async function sendToTidarr(mediaItem: any, asAlbum = false): Promise<void> {
  const settings = await getSettings();
  const { tidarrUrl, adminPassword, downloadQuality } = settings;
  const quality = downloadQuality || "high";

  if (!tidarrUrl?.trim()) {
    trace.msg.err("Tidarr URL not configured in settings");
    return;
  }

  const baseUrl = tidarrUrl.replace(/\/+$/, "");

  try {
    let token: string | undefined;

    if (adminPassword) {
      const authResponse = await ftch.json(`${baseUrl}/api/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword }),
      }) as TidarrAuthResponse;

      if (!authResponse.token) {
        trace.msg.err("failed to authenticate with tidarr");
        return;
      }

      token = authResponse.token;
    }

    const tidalItem: any = mediaItem.tidalItem || mediaItem;

    let detectedType = "track";

    if (mediaItem.type) {
      detectedType = String(mediaItem.type).toLowerCase();
    } else if (asAlbum && tidalItem.album) {
      detectedType = "album";
    }

    let itemType = detectedType;
    let itemUrl: string | undefined;

    const album = tidalItem.album || tidalItem;

    const rawId =
      itemType === "album"
        ? album?.id
        : tidalItem?.id ?? mediaItem?.id ?? mediaItem?.tidalItem?.id;

    if (rawId == null) {
      trace.msg.err("Cannot send to Tidarr: missing Tidal item id", mediaItem);
      return;
    }

    const firstArtist =
      Array.isArray(tidalItem.artists) && tidalItem.artists.length > 0
        ? tidalItem.artists[0].name
        : undefined;

    let item: any = {
      id: String(rawId),
      status: "queue_download",
      loading: true,
      error: false,
      quality,
    };

    switch (itemType) {
      case "album": {
        itemUrl = album.url || `https://listen.tidal.com/album/${album.id}`;

        item.type = "album";
        item.url = itemUrl;
        item.title = album.title;
        item.artist = firstArtist;
        item.date = album.releaseDate || tidalItem.album?.releaseDate;

        break;
      }

      case "track": {
        itemUrl = tidalItem.url || `https://listen.tidal.com/track/${tidalItem.id}`;

        item.type = "track";
        item.url = itemUrl;
        item.title = tidalItem.title;
        item.artist = firstArtist;
        item.album = tidalItem.album?.title;
        item.date = tidalItem.album?.releaseDate;
        item.track_number =
          typeof tidalItem.trackNumber === "number"
            ? tidalItem.trackNumber
            : undefined;

        break;
      }

      case "video": {
        itemUrl = tidalItem.url || `https://listen.tidal.com/video/${tidalItem.id}`;

        item.type = "video";
        item.url = itemUrl;
        item.title = tidalItem.title;
        item.artist = firstArtist;
        item.quality = mediaItem.quality || quality || "fhd";
        item.album = tidalItem.album?.title;
        item.date = tidalItem.album?.releaseDate;

        break;
      }

      case "playlist": {
        itemUrl = tidalItem.url || `https://listen.tidal.com/playlist/${tidalItem.id}`;

        item.type = "playlist";
        item.url = itemUrl;
        item.title = tidalItem.title;
        item.artist = firstArtist;

        break;
      }

      case "mix": {
        itemUrl = tidalItem.url || `https://listen.tidal.com/mix/${tidalItem.id}`;

        item.type = "mix";
        item.url = itemUrl;
        item.title = tidalItem.title;
        item.artist = firstArtist;

        break;
      }

      case "artist": {
        itemUrl = tidalItem.url || `https://listen.tidal.com/artist/${tidalItem.id}`;

        item.type = "artist";
        item.url = itemUrl;
        item.title = tidalItem.title || tidalItem.name;

        break;
      }

      case "artist_videos": {
        itemUrl = tidalItem.url || `https://listen.tidal.com/artist/${tidalItem.id}`;

        item.type = "artist_videos";
        item.url = itemUrl;
        item.title = tidalItem.title || tidalItem.name;

        break;
      }

      case "favorite_albums":
      case "favorite_tracks":
      case "favorite_playlists": {
        item.type = itemType;
        item.title = tidalItem.title || itemType;
        item.url = tidalItem.url;
        break;
      }

      default: {
        itemType = "track";
        itemUrl = tidalItem.url || `https://listen.tidal.com/track/${tidalItem.id}`;

        item.type = "track";
        item.url = itemUrl;
        item.title = tidalItem.title;
        item.artist = firstArtist;
        item.album = tidalItem.album?.title;
        item.date = tidalItem.album?.releaseDate;
        item.track_number =
          typeof tidalItem.trackNumber === "number"
            ? tidalItem.trackNumber
            : undefined;

        break;
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await ftch.text(`${baseUrl}/api/save`, {
      method: "POST",
      headers,
      body: JSON.stringify({ item }),
    });

    const isSuccess =
      response === "Created" ||
      response.toLowerCase().includes("created") ||
      /\b201\b/.test(response);

    if (isSuccess) {
      trace.msg.log(
        `successfully sent to tidarr: type=${itemType} id=${item.id} url=${itemUrl || item.url || itemType}`
      );
    } else {
      trace.msg.warn(`unexpected response from tidarr: ${response}`);
    }
  } catch (error: any) {
    trace.msg.err("failed to send to tidarr:", error.message || error);
  }
}

ContextMenu.onMediaItem(unloads, async ({ mediaCollection, contextMenu }) => {
  const settings = await getSettings();
  const debugMode = settings.debugMode;

  // convert async iterable to array for processing
  const mediaItemsArray: any[] = [];
  for await (const item of await mediaCollection.mediaItems()) {
    mediaItemsArray.push(item);
  }

  if (!mediaItemsArray.length) return;

  const firstItem = mediaItemsArray[0];

  // check if all items belong to the same album
  const isAlbumContext =
    firstItem.tidalItem?.album &&
    mediaItemsArray.length > 1 &&
    mediaItemsArray.every(
      (item) =>
        item.tidalItem?.album?.id === firstItem.tidalItem?.album?.id
    );

  const tidarrButton = (ContextMenu as any).addButton(unloads);
  tidarrButton.text = isAlbumContext
    ? "Send Album to Tidarr"
    : `Send ${mediaItemsArray.length} Track(s) to Tidarr`;

  tidarrButton.onClick(async () => {
    tidarrButton.text = "Sending to Tidarr...";

    try {
      if (isAlbumContext) {
        await sendToTidarr(firstItem, true);
      } else {
        for (const item of mediaItemsArray) {
          await sendToTidarr(item, false);
        }
      }

      tidarrButton.text = isAlbumContext
        ? "Sent Album to Tidarr!"
        : `Sent ${mediaItemsArray.length} Track(s) to Tidarr!`;
    } catch (err) {
      trace.msg.err("Error sending to Tidarr:", err);
      tidarrButton.text = "Failed to Send to Tidarr";
    }

    setTimeout(() => {
      tidarrButton.text = isAlbumContext
        ? "Send Album to Tidarr"
        : `Send ${mediaItemsArray.length} Track(s) to Tidarr`;
    }, 3000);
  });

  await tidarrButton.show(contextMenu);

  if (debugMode) {
    const debugButton = (ContextMenu as any).addButton(unloads);
    debugButton.text = "[DEBUG] Show Media Info";
    debugButton.onClick(() => {
      const win = window.open("", "Tidarr Item Info", "width=500,height=400,resizable");
      if (win) {
        win.document.body.innerHTML = "";
        const pre = win.document.createElement("pre");
        pre.textContent = JSON.stringify(firstItem, null, 2);
        win.document.body.appendChild(pre);
      }
    });
    await debugButton.show(contextMenu);
  }
});
