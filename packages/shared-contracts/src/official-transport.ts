/** Native `thread/read` can return hundreds of megabytes for long Threads, so the
 * Host transport must not impose the library default WebSocket payload ceiling.
 * Keep the Host's own inbound server at the same ceiling so large Desktop frames
 * (for example thread payloads echoed back over Remote Control) are not dropped
 * asymmetrically. */
export const OFFICIAL_APP_SERVER_MAX_FRAME_BYTES = 512 * 1024 * 1024;
