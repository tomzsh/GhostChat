import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Simple terminal-style favicon so /favicon.ico is not a 404 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#33ff66",
          fontSize: 20,
          fontFamily: "monospace",
          fontWeight: 700,
        }}
      >
        G
      </div>
    ),
    { ...size }
  );
}
