import Foundation
import Vision
import CoreGraphics
import ImageIO

let src = CommandLine.arguments[1]
guard let url = URL(string: "file://\(src)"),
      let imgSource = CGImageSourceCreateWithURL(url as CFURL, nil),
      let cgImg = CGImageSourceCreateImageAtIndex(imgSource, 0, nil) else { exit(1) }

let faceReq = VNDetectFaceRectanglesRequest()
let handler = VNImageRequestHandler(cgImage: cgImg, options: [:])
try? handler.perform([faceReq])

let w = Double(cgImg.width)
let h = Double(cgImg.height)

for f in faceReq.results ?? [] {
    let bb = f.boundingBox
    // Convert from bottom-left origin to top-left origin
    let x1 = bb.origin.x * w
    let y1 = (1.0 - bb.origin.y - bb.height) * h
    let x2 = (bb.origin.x + bb.width) * w
    let y2 = (1.0 - bb.origin.y) * h
    print("\(x1),\(y1),\(x2),\(y2)")
}
