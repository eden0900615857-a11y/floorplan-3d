// 內建範例平面圖：用 Canvas 畫一張黑白施工圖風格的兩房格局，含門弧、家具、文字與尺寸線；
// 另一張是同樣格局的建商彩色格局圖風格（木紋地板、磁磚、彩色家具、陰影、浮水印）。
// 牆、窗、門、家具輪廓的座標是資料（1000 × 700 的圖），test/pipeline.test.js 用同一份資料在 Node 畫出範例圖來測辨識流程。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPSample = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SIZE = [1000, 700];
  // 牆：實心矩形 [x, y, 寬, 高]
  const WALLS = [
    // 外牆（厚 14）
    [60,60,160,14],[300,60,300,14],[700,60,240,14],
    [60,626,380,14],[520,626,420,14],
    [60,60,14,580],[926,60,14,580],
    // 內牆（厚 9）
    [420,74,9,306],[600,74,9,306],
    [429,300,100,9],
    [74,380,250,9],[394,380,35,9],
    [609,380,40,9],[719,380,207,9],
    [700,389,9,131]
  ];
  // 窗：上方外牆缺口的 x 範圍 [x0, x1]（牆在 y 60–74）
  const WINDOWS = [[220,300],[600,700]];
  // 門：門軸 (hx, hy)、半徑、開門弧的起訖角度、門片另一端 (lx, ly)
  const DOORS = [
    [440,626,80,Math.PI*1.5,Math.PI*2,440,546],
    [324,389,70,0,Math.PI/2,324,459],
    [649,389,70,0,Math.PI/2,649,459],
    [529,309,71,0,Math.PI/2,529,380]
  ];
  // 家具輪廓（黑白範例）：空心矩形 [x, y, 寬, 高]
  const FURNITURE = [
    [110,110,150,200],[110,110,150,40],
    [700,110,130,180],[700,110,130,36],
    [140,540,260,70],[210,450,120,60],
    [760,580,150,40]
  ];
  function drawSamplePlan(){
    const c = document.createElement('canvas'); c.width = 1000; c.height = 700;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0,0,1000,700);
    g.fillStyle = '#111';
    WALLS.forEach(w=>g.fillRect(...w));
    g.strokeStyle = '#111'; g.lineWidth = 1.5;
    // 窗（牆上缺口內的細雙線）
    WINDOWS.forEach(([a,b])=>{
      g.beginPath(); g.moveTo(a,64); g.lineTo(b,64); g.moveTo(a,70); g.lineTo(b,70); g.stroke();
    });
    // 門（開門弧線與門片）
    const door=(hx,hy,r,a0,a1,lx,ly)=>{g.beginPath();g.arc(hx,hy,r,a0,a1);g.stroke();g.beginPath();g.moveTo(hx,hy);g.lineTo(lx,ly);g.stroke();};
    DOORS.forEach(d=>door(...d));
    // 家具輪廓
    g.lineWidth = 2;
    FURNITURE.forEach(f=>g.strokeRect(...f));
    g.beginPath(); g.ellipse(470,150,26,34,0,0,Math.PI*2); g.stroke();
    // 房間名稱與面積
    g.fillStyle = '#111'; g.textAlign = 'center';
    const label=(t,s,x,y)=>{g.font='600 22px "Noto Sans TC",sans-serif';g.fillText(t,x,y);g.font='15px "IBM Plex Mono",monospace';g.fillText(s,x,y+22);};
    label('主臥室','4.7 × 4.2 m',300,250);
    label('衛浴','2.3 × 3.0 m',515,230);
    label('次臥室','4.3 × 4.2 m',790,330);
    label('客廳','8.5 × 3.2 m',400,460);
    label('廚房','3.1 × 3.2 m',820,470);
    // 尺寸標註線
    g.lineWidth = 1; g.beginPath();
    g.moveTo(60,32); g.lineTo(940,32); g.moveTo(60,24); g.lineTo(60,40); g.moveTo(940,24); g.lineTo(940,40);
    g.moveTo(972,60); g.lineTo(972,640); g.moveTo(964,60); g.lineTo(980,60); g.moveTo(964,640); g.lineTo(980,640);
    g.stroke();
    g.font='14px "IBM Plex Mono",monospace'; g.fillText('12,000',500,26);
    g.save(); g.translate(990,350); g.rotate(-Math.PI/2); g.fillText('7,900',0,0); g.restore();
    return c;
  }
  // 彩色格局圖：深灰色的牆、木紋與磁磚地板、彩色家具插圖、陰影與浮水印
  function drawColorPlan(){
    const c = document.createElement('canvas'); c.width = 1000; c.height = 700;
    const g = c.getContext('2d');
    g.fillStyle = '#FBF8F3'; g.fillRect(0,0,1000,700);
    // 地板：臥室與客廳木紋，衛浴與廚房磁磚
    const wood=(x,y,w,h,base)=>{
      g.fillStyle=base; g.fillRect(x,y,w,h);
      for(let yy=y,i=0;yy<y+h;yy+=12,i++){
        g.fillStyle=i%2?'rgba(120,70,30,.12)':'rgba(255,230,190,.12)'; g.fillRect(x,yy,w,12);
        g.fillStyle='rgba(110,70,40,.35)'; g.fillRect(x,yy,w,1);
        for(let xx=x+((i*37)%90);xx<x+w;xx+=90) g.fillRect(xx,yy,1,12);
      }
    };
    const tile=(x,y,w,h)=>{
      g.fillStyle='#DDE3E6'; g.fillRect(x,y,w,h);
      g.fillStyle='#F4F6F7';
      for(let xx=x;xx<x+w;xx+=24) g.fillRect(xx,y,2,h);
      for(let yy=y;yy<y+h;yy+=24) g.fillRect(x,yy,w,2);
    };
    wood(74,74,346,306,'#D9AE7C'); wood(609,74,317,306,'#D9AE7C');
    wood(74,389,626,237,'#C99A66'); tile(429,74,171,226); tile(709,389,217,237);
    // 家具（有顏色、帶陰影）
    const shadow=(f)=>{g.save();g.shadowColor='rgba(0,0,0,.25)';g.shadowBlur=8;g.shadowOffsetX=3;g.shadowOffsetY=3;f();g.restore();};
    shadow(()=>{g.fillStyle='#FFFFFF';g.fillRect(110,110,150,200);});
    g.fillStyle='#8FB3D9'; g.fillRect(110,170,150,140);
    g.fillStyle='#F0F0F0'; g.fillRect(120,118,58,36); g.fillRect(192,118,58,36);
    shadow(()=>{g.fillStyle='#FFFFFF';g.fillRect(700,110,130,180);});
    g.fillStyle='#E7A9A0'; g.fillRect(700,165,130,125);
    shadow(()=>{g.fillStyle='#E0894F';g.fillRect(140,540,260,70);});
    g.fillStyle='#EFA06C'; g.fillRect(150,548,240,40);
    g.fillStyle='rgba(170,60,60,.55)'; g.fillRect(190,440,160,80);
    shadow(()=>{g.fillStyle='#A4744A';g.fillRect(210,450,120,60);});
    shadow(()=>{g.fillStyle='#FFFFFF';g.fillRect(760,580,150,40);});
    g.fillStyle='#B9C7CF'; g.fillRect(770,586,40,28);
    g.fillStyle='#FFFFFF'; g.beginPath(); g.ellipse(470,150,26,34,0,0,Math.PI*2); g.fill();
    g.strokeStyle='#9AA6AD'; g.lineWidth=2; g.stroke();
    for(const [x,y] of [[95,600],[900,100],[670,560]]){
      g.fillStyle='#5E9E4F'; g.beginPath(); g.arc(x,y,16,0,Math.PI*2); g.fill();
      g.fillStyle='#7DBA68'; g.beginPath(); g.arc(x-4,y-4,9,0,Math.PI*2); g.fill();
    }
    // 牆：深灰色
    g.fillStyle = '#3F3F3F';
    WALLS.forEach(w=>g.fillRect(...w));
    // 窗：淺藍色
    g.fillStyle = '#9CC9E8';
    WINDOWS.forEach(([a,b])=>g.fillRect(a,63,b-a,8));
    // 門：灰色細線
    g.strokeStyle = '#6B6B6B'; g.lineWidth = 1.5;
    const door=(hx,hy,r,a0,a1,lx,ly)=>{g.beginPath();g.arc(hx,hy,r,a0,a1);g.stroke();g.beginPath();g.moveTo(hx,hy);g.lineTo(lx,ly);g.stroke();};
    DOORS.forEach(d=>door(...d));
    // 房名與坪數
    g.textAlign='center';
    const label=(t,s,x,y)=>{g.fillStyle='#333';g.font='600 22px "Noto Sans TC",sans-serif';g.fillText(t,x,y);g.fillStyle='#8A5A2B';g.font='15px "Noto Sans TC",sans-serif';g.fillText(s,x,y+22);};
    label('主臥室','約 6 坪',300,350);
    label('衛浴','',515,260);
    label('次臥室','約 5.4 坪',770,340);
    label('客餐廳','約 8.2 坪',520,470);
    label('廚房','',820,470);
    // 浮水印
    g.save(); g.translate(500,360); g.rotate(-0.35); g.fillStyle='rgba(120,120,120,.12)'; g.font='700 90px "Noto Sans TC",sans-serif'; g.fillText('僅供參考',0,0); g.restore();
    return c;
  }
  return { draw: drawSamplePlan, drawColor: drawColorPlan, SIZE, WALLS, WINDOWS, DOORS, FURNITURE };
});
