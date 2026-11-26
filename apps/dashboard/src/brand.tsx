export const PRODUCT_NAME = 'Infrared';

export function ProductMark({className = ''}: {className?: string}) {
  return (
    <img
      className={'product-mark ' + className}
      src="/branding/infrared-mark.svg"
      alt=""
      aria-hidden="true"
      width="40"
      height="40"
    />
  );
}

export function ProductBrand() {
  return (
    <span className="product-lockup">
      <ProductMark />
      <strong className="product-name">{PRODUCT_NAME}</strong>
    </span>
  );
}

export function WorkspaceBrand({onHome}: {onHome: () => void}) {
  return (
    <div className="workspace-brand">
      <a className="brand" href="#projects" aria-label="Infrared home" onClick={onHome}>
        <ProductBrand />
      </a>
    </div>
  );
}
