import AppKit
let size: CGFloat = 1024
let image = NSImage(size: NSSize(width:size,height:size))
image.lockFocus()
NSColor(calibratedRed:0.33,green:0.45,blue:0.35,alpha:1).setFill()
NSBezierPath(roundedRect:NSRect(x:48,y:48,width:928,height:928),xRadius:210,yRadius:210).fill()
let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
let attrs:[NSAttributedString.Key:Any] = [.font:NSFont(name:"Georgia-Italic",size:660)!, .foregroundColor:NSColor(calibratedRed:0.97,green:0.97,blue:0.91,alpha:1), .paragraphStyle:paragraph]
("m" as NSString).draw(in:NSRect(x:80,y:156,width:864,height:790),withAttributes:attrs)
let path = NSBezierPath();path.move(to:NSPoint(x:685,y:740));path.line(to:NSPoint(x:826,y:825));path.line(to:NSPoint(x:816,y:737));path.move(to:NSPoint(x:826,y:825));path.line(to:NSPoint(x:736,y:835));path.lineWidth=28;path.lineCapStyle = .round;NSColor(calibratedRed:0.76,green:0.85,blue:0.68,alpha:1).setStroke();path.stroke()
image.unlockFocus()
let bitmap = NSBitmapImageRep(data:image.tiffRepresentation!)!
try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
