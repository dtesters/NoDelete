import { findByProps, findByStoreName } from "@vendetta/metro/filters";
import { React, fluxDispatcher } from "@vendetta/metro/common";
import { patcher } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";

// Stores
const MessageStore = findByStoreName("MessageStore");
const ChannelStore = findByStoreName("ChannelStore");

// Utilities & UI
const { openContextMenuLazy } = findByProps("openContextMenuLazy");
const { showToast } = findByProps("showToast");

// Initialise persistent storage
if (!storage.logs) storage.logs = {} as Record<string, any[]>;

type LogEntry =
  | { type: "delete"; timestamp: number; message: any }
  | { type: "edit"; timestamp: number; before: any; after: any };

function ensureLog(channelId: string): LogEntry[] {
  if (!storage.logs[channelId]) storage.logs[channelId] = [];
  return storage.logs[channelId] as LogEntry[];
}

function logEvent(channelId: string, entry: LogEntry) {
  ensureLog(channelId).push(entry);
}

function cloneMessage(msg: any) {
  if (!msg) return null;
  return {
    id: msg.id,
    channelId: msg.channel_id ?? msg.channelId,
    author: msg.author,
    content: msg.content,
    embeds: msg.embeds,
    attachments: msg.attachments,
    timestamp: msg.timestamp,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Flux Event Handlers
// ─────────────────────────────────────────────────────────────────────────────

const handlers: Array<[string, (...args: any[]) => void]> = [];

function handleDelete(payload: any) {
  const { channelId, id } = payload;
  const message = MessageStore?.getMessage?.(channelId, id);
  logEvent(channelId, {
    type: "delete",
    timestamp: Date.now(),
    message: cloneMessage(message) ?? { id, channelId },
  });
}

function handleUpdate(payload: any) {
  const newMsg = payload.message;
  const channelId = newMsg?.channel_id ?? newMsg?.channelId;
  const oldMsg = MessageStore?.getMessage?.(channelId, newMsg.id);
  logEvent(channelId, {
    type: "edit",
    timestamp: Date.now(),
    before: cloneMessage(oldMsg),
    after: cloneMessage(newMsg),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Menu Patch (Clear log)
// ─────────────────────────────────────────────────────────────────────────────

let unpatchContextMenu: (() => void) | undefined;

function patchChannelContextMenu() {
  unpatchContextMenu = patcher.before("no-delete+", openContextMenuLazy, "openContextMenuLazy", (args) => {
    const [, opts] = args as any[];
    const channel = opts?.channel;
    if (!channel) return;

    const originalBuilder = args[0];
    args[0] = (...builderArgs: any[]) => {
      const ret = originalBuilder(...builderArgs);
      if (!Array.isArray(ret)) return ret;
      const [lazyRender, ctx] = ret;

      ret[0] = async (...inner: any[]) => {
        const Menu: any = await lazyRender(...inner);
        return (props: any) => {
          const menu = React.createElement(Menu, props);
          try {
            if (menu?.props?.children?.props?.children) {
              menu.props.children.props.children.push(
                React.createElement(Menu.MenuItem, {
                  id: "clear-log",
                  label: "Clear log",
                  onPress: () => {
                    storage.logs[channel.id] = [];
                    showToast(`Cleared logs for ${channel?.name ?? "channel"}`);
                  },
                })
              );
            }
          } catch (_) {}
          return menu;
        };
      };
      return ret;
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export function onLoad() {
  handlers.push(["MESSAGE_DELETE", handleDelete]);
  handlers.push(["MESSAGE_UPDATE", handleUpdate]);

  for (const [evt, fn] of handlers) fluxDispatcher.subscribe(evt, fn);

  patchChannelContextMenu();
}

export function onUnload() {
  for (const [evt, fn] of handlers) fluxDispatcher.unsubscribe(evt, fn);
  handlers.length = 0;

  unpatchContextMenu?.();
}
