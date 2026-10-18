import Foundation
import Vision
import CoreGraphics
import CoreImage
import ImageIO

guard CommandLine.arguments.count >= 3 else {
    print("Usage: single_mosaic.swift <src> <dst>")
    exit(1)
}

let srcPath = CommandLine.arguments[1]
let dstPath = CommandLine.arguments[2]

guard let url = URL(string: "file://\(srcPath)"),
      let imgSource = CGImageSourceCreateWithURL(url as CFURL, nil),
      let cgImg = CGImageSourceCreateImageAtIndex(imgSource, 0, nil) else {
    exit(1)
}

let ciImg = CIImage(cgImage: cgImg)
let w = CGFloat(cgImg.width)
let h = CGFloat(cgImg.height)

let faceReq = VNDetectFaceRectanglesRequest()
let humanReq = VNDetectHumanRectanglesRequest()
let handler = VNImageRequestHandler(cgImage: cgImg, options: [:])
try? handler.perform([faceReq, humanReq])

var mosaicRects: [CGRect] = []

// 1) Faces detected: 80% inner face only (eyes, nose, mouth) preserving hair, chin, and contour
if let faces = faceReq.results {
    for f in faces {
        let bb = f.boundingBox
        let fw = bb.width * w
        let fh = bb.height * h
        let fcx = (bb.origin.x + bb.width / 2.0) * w
        let fcy = (bb.origin.y + bb.height * 0.48) * h
        let w80 = fw * 0.80
        let h80 = fh * 0.82
        let innerRect = CGRect(x: fcx - w80 / 2.0, y: fcy - h80 / 2.0, width: w80, height: h80)
        mosaicRects.append(innerRect)
    }
}

// 2) Humans detected (for distant background passersby, compact head area only)
if let humans = humanReq.results {
    for human in humans {
        let bb = human.boundingBox
        let hw = bb.width * w * 0.65
        let hh = bb.height * h * 0.20
        let hcx = (bb.origin.x + bb.width / 2.0) * w
        let hcy = (bb.origin.y + bb.height * 0.85) * h
        let headRect = CGRect(x: hcx - hw / 2.0, y: hcy - hh / 2.0, width: hw, height: hh)
        let alreadyCovered = mosaicRects.contains { $0.intersects(headRect) }
        if !alreadyCovered {
            mosaicRects.append(headRect)
        }
    }
}

if mosaicRects.isEmpty {
    if srcPath != dstPath {
        try? FileManager.default.removeItem(atPath: dstPath)
        try? FileManager.default.copyItem(atPath: srcPath, toPath: dstPath)
    }
    print("MOSAIC_DONE: 0 regions")
    exit(0)
}

// Adaptive pixel size based on image width
let pixelScale = max(14.0, Double(min(w, h)) / 110.0)
let pixFilter = CIFilter(name: "CIPixellate")!
pixFilter.setValue(ciImg, forKey: kCIInputImageKey)
pixFilter.setValue(pixelScale, forKey: kCIInputScaleKey)
guard let mosaicImg = pixFilter.outputImage?.cropped(to: ciImg.extent) else { exit(1) }

let context = CGContext(data: nil, width: Int(w), height: Int(h), bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
context.setFillColor(gray: 0, alpha: 1)
context.fill(CGRect(x: 0, y: 0, width: w, height: h))
context.setFillColor(gray: 1, alpha: 1)
for r in mosaicRects {
    context.fillEllipse(in: r)
}
guard let maskCG = context.makeImage() else { exit(1) }
let maskCI = CIImage(cgImage: maskCG)

let maskBlur = CIFilter(name: "CIGaussianBlur")!
maskBlur.setValue(maskCI, forKey: kCIInputImageKey)
maskBlur.setValue(max(5.0, Double(min(w, h)) * 0.003), forKey: kCIInputRadiusKey)
let smoothMask = maskBlur.outputImage?.cropped(to: ciImg.extent) ?? maskCI

let blendFilter = CIFilter(name: "CIBlendWithMask")!
blendFilter.setValue(mosaicImg, forKey: kCIInputImageKey)
blendFilter.setValue(ciImg, forKey: kCIInputBackgroundImageKey)
blendFilter.setValue(smoothMask, forKey: kCIInputMaskImageKey)

guard let resultCI = blendFilter.outputImage else { exit(1) }
let ciContext = CIContext()
guard let finalCG = ciContext.createCGImage(resultCI, from: ciImg.extent) else { exit(1) }

let outUrl = URL(fileURLWithPath: dstPath)
try? FileManager.default.removeItem(at: outUrl)
guard let dest = CGImageDestinationCreateWithURL(outUrl as CFURL, "public.png" as CFString, 1, nil) else { exit(1) }
CGImageDestinationAddImage(dest, finalCG, nil)
CGImageDestinationFinalize(dest)

print("MOSAIC_DONE: \(mosaicRects.count) regions")
