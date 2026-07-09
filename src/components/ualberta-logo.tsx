import Image from "next/image";

type UAlbertaLogoProps = {
  compact?: boolean;
  className?: string;
  priority?: boolean;
};

export function UAlbertaLogo({ compact = false, className = "", priority = false }: UAlbertaLogoProps) {
  const imageHeightClass = compact ? "h-8 sm:h-9" : "h-10 sm:h-12";
  const displayWidth = compact ? "176px" : "212px";
  const wrapperClassName = [
    "inline-flex shrink-0 items-center rounded bg-white p-2 shadow-sm",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={wrapperClassName}>
      <Image
        alt="University of Alberta"
        className={`${imageHeightClass} w-auto object-contain`}
        height={404}
        priority={priority}
        sizes={displayWidth}
        src="/brand/ualberta-logo.png"
        width={1412}
      />
    </span>
  );
}
