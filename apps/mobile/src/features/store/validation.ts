export function parseStrictInteger(value: string) {
  const normalizedValue = value.trim();
  if (!/^-?\d+$/.test(normalizedValue)) {
    return null;
  }
  const parsedValue = Number.parseInt(normalizedValue, 10);
  return Number.isNaN(parsedValue) ? null : parsedValue;
}

export function parseStoreNumbers(priceValue: string, stockValue: string) {
  const parsedPrice = parseStrictInteger(priceValue);
  const normalizedStock = stockValue.trim();
  const parsedStock = normalizedStock.length > 0 ? parseStrictInteger(normalizedStock) : null;
  if (
    parsedPrice === null ||
    parsedPrice <= 0 ||
    (normalizedStock.length > 0 && parsedStock === null) ||
    (parsedStock !== null && parsedStock < 0)
  ) {
    return null;
  }
  return {
    price: parsedPrice,
    stock: parsedStock
  };
}

export function parseRedemptionQuantity(value: string) {
  const parsedQuantity = parseStrictInteger(value);
  return parsedQuantity !== null && parsedQuantity > 0 ? parsedQuantity : null;
}
