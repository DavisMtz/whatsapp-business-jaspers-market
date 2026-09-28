export default function Logo({ size = 40 }: { size?: number }) {
  return <img className="logo" src="/icon.svg" width={size} height={size} alt="" />;
}
