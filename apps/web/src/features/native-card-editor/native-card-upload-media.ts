import { nativeCardFileRules } from "@tavern/shared";

type AssetMediaFormat = (typeof nativeCardFileRules.assetMediaFormats)[number];

export type NativeCardUploadMediaResolution =
  | { status: "resolved"; mediaType: string }
  | { status: "unsupported-extension"; extensions: string[] }
  | { status: "unsupported-media-type"; extension: string; mediaType: string };

export function resolveNativeCardUploadMediaType(
  fileName: string,
  browserMediaType: string | undefined,
  formats: readonly AssetMediaFormat[] = nativeCardFileRules.assetMediaFormats,
): NativeCardUploadMediaResolution {
  const baseName = fileName.split(/[\\/]/).at(-1) ?? "";
  const extensionIndex = baseName.lastIndexOf(".");
  const extension = extensionIndex > 0 ? baseName.slice(extensionIndex).toLowerCase() : "";
  const configuredFormat = formats
    .flatMap((format) => format.extensions.map((item) => ({ format, ...item })))
    .find((item) => item.extension.toLowerCase() === extension);
  if (!configuredFormat) {
    return {
      status: "unsupported-extension",
      extensions: [...new Set(formats.flatMap((format) => format.extensions.map((item) => item.extension)))].sort(),
    };
  }

  const declaredType = browserMediaType?.trim().toLowerCase() ?? "";
  if (declaredType && declaredType !== "application/octet-stream" && !configuredFormat.format.mediaTypes.includes(declaredType)) {
    return { status: "unsupported-media-type", extension, mediaType: declaredType };
  }

  return { status: "resolved", mediaType: configuredFormat.mediaType };
}

export function isNativeCardMediaReplacementCompatible(
  targetPath: string,
  uploadedFileName: string,
  formats: readonly AssetMediaFormat[] = nativeCardFileRules.assetMediaFormats,
): boolean {
  const formatForExtension = (path: string): string | undefined => {
    const baseName = path.split(/[\\/]/).at(-1) ?? "";
    const extensionIndex = baseName.lastIndexOf(".");
    const extension = extensionIndex > 0 ? baseName.slice(extensionIndex).toLowerCase() : "";
    return formats.find((format) => format.extensions.some((item) => item.extension.toLowerCase() === extension))?.id;
  };
  const targetFormat = formatForExtension(targetPath);
  return !!targetFormat && formatForExtension(uploadedFileName) === targetFormat;
}
