declare module "react-native-mlkit-ocr" {
  export type OcrElement = {
    text?: string;
    confidence?: number;
  };

  export type OcrLine = {
    text?: string;
    confidence?: number;
    elements?: OcrElement[];
  };

  export type OcrBlock = {
    text?: string;
    confidence?: number;
    lines?: OcrLine[];
  };

  const MlkitOcr: {
    detectFromUri?: (uri: string) => Promise<OcrBlock[]>;
    detectFromFile?: (uri: string) => Promise<OcrBlock[]>;
    recognize?: (uri: string) => Promise<OcrBlock[]>;
  };

  export default MlkitOcr;
}
