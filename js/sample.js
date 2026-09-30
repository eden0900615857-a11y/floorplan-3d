// 內建範例平面圖：用 Canvas 畫一張黑白施工圖風格的兩房格局，含門弧、家具、文字與尺寸線。
(function (root) {
  function drawSamplePlan(){
    const c = document.createElement('canvas'); c.width = 1000; c.height = 700;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0,0,1000,700);
    g.fillStyle = '#111';
    const walls = [
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
    walls.forEach(w=>g.fillRect(...w));
    g.strokeStyle = '#111'; g.lineWidth = 1.5;
    // 窗（牆上缺口內的細雙線）
    [[220,300],[600,700]].forEach(([a,b])=>{
      g.beginPath(); g.moveTo(a,64); g.lineTo(b,64); g.moveTo(a,70); g.lineTo(b,70); g.stroke();
    });
    // 門（開門弧線與門片）
    const door=(hx,hy,r,a0,a1,lx,ly)=>{g.beginPath();g.arc(hx,hy,r,a0,a1);g.stroke();g.beginPath();g.moveTo(hx,hy);g.lineTo(lx,ly);g.stroke();};
    door(440,626,80,Math.PI*1.5,Math.PI*2,440,546);
    door(324,389,70,0,Math.PI/2,324,459);
    door(649,389,70,0,Math.PI/2,649,459);
    door(529,309,71,0,Math.PI/2,529,380);
    // 家具輪廓
    g.lineWidth = 2;
    g.strokeRect(110,110,150,200); g.strokeRect(110,110,150,40);
    g.strokeRect(700,110,130,180); g.strokeRect(700,110,130,36);
    g.strokeRect(140,540,260,70); g.strokeRect(210,450,120,60);
    g.strokeRect(760,580,150,40);
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
  root.FPSample = { draw: drawSamplePlan };
})(self);
