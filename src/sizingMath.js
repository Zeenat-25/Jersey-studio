// Shared M-size (21 x 29 inch) proportional sizing for preview and print export.
import { getSleeveDimensions } from './sizeChart';

export const MASTER_WIDTH = 21;
export const MASTER_HEIGHT = 29;
const positive = (v, fallback) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback;

export function scaleBox(baseWidth, baseHeight, pageWidth, pageHeight) {
  return {
    width: positive(baseWidth, 0.1) * (positive(pageWidth, MASTER_WIDTH) / MASTER_WIDTH),
    height: positive(baseHeight, 0.1) * (positive(pageHeight, MASTER_HEIGHT) / MASTER_HEIGHT),
  };
}

export function scaleWidth(baseWidth, pageWidth) {
  return positive(baseWidth, 0.1) * (positive(pageWidth, MASTER_WIDTH) / MASTER_WIDTH);
}

export function scaleHeight(baseHeight, pageHeight) {
  return positive(baseHeight, 0.1) * (positive(pageHeight, MASTER_HEIGHT) / MASTER_HEIGHT);
}

export function scalePoints(basePoints, pageWidth) {
  return positive(basePoints, 1) * (positive(pageWidth, MASTER_WIDTH) / MASTER_WIDTH);
}

export function scaleSleeveDimensions(sizeCode, sleeveType='Half') {
  return getSleeveDimensions(sizeCode, sleeveType);
}

// Fit text without distorting glyph aspect ratios.
export function containScale(sourceWidth, sourceHeight, boxWidth, boxHeight) {
  return Math.min(
    positive(boxWidth, 0.1) / positive(sourceWidth, 1),
    positive(boxHeight, 0.1) / positive(sourceHeight, 1),
  );
}

export function fitScaleByWidth(sourceWidth, maxWidth) {
  return Math.min(1, positive(maxWidth, 0.1) / positive(sourceWidth, 1));
}
