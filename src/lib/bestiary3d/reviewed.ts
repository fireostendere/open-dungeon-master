// Three individually art-directed models. Authored in metres at medium scale,
// facing +Z; equipment is parented to its grip, focus to the actual anatomy.
// References: Open5e tob2_a-mi-kuk, SRD kobold / planetar (2014).
import {
  CatmullRomCurve3, Color, ExtrudeGeometry, Float32BufferAttribute,
  Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Shape, Vector3, type Material, type Object3D,
} from "three";
import { ball, box, cyl, loft, mountSurface, place, surfaceTendon, tendon, tick, torus, type Ctx } from "./parts";

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

function panel(points: number[][], depth: number, mat: Material, bevel = 0.006): Mesh {
  const shape = new Shape();
  points.forEach(([x, y], i) => i ? shape.lineTo(x!, y!) : shape.moveTo(x!, y!));
  shape.closePath();
  const geo = new ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, steps: 1, curveSegments: 8 });
  geo.translate(0, 0, -depth / 2);
  return new Mesh(geo, mat);
}

function named<T extends Object3D>(object: T, name: string): T {
  object.name = name;
  return object;
}

function focus(ctx: Ctx, parent: Group, name: string, x: number, y: number, z: number): Group {
  const anchor = named(place(new Group(), x, y, z), name);
  parent.add(anchor);
  ctx.focus = anchor;
  return anchor;
}

export function buildAmikuk(ctx: Ctx): void {
  const { root, mats } = ctx;
  const wet = new MeshPhysicalMaterial({ color: "#a35d68", roughness: 0.43, clearcoat: 0.85, clearcoatRoughness: 0.19, vertexColors: true });
  const fold = new MeshStandardMaterial({ color: "#431d2e", roughness: 0.46 });
  const slime = new MeshPhysicalMaterial({ color: "#a63148", roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.07 });
  const body = new Group();
  root.add(body);
  const trunk = loft([
    [0.20, 0.18, 0.25, -0.15], [0.30, 0.36, 0.35, -0.15], [0.5, 0.48, 0.41, -0.12],
    [0.73, 0.52, 0.43, -0.08], [0.94, 0.47, 0.36, 0], [1.10, 0.35, 0.28, 0.04], [1.18, 0.17, 0.15, 0.05],
  ], wet, 40);
  body.add(named(trunk, "main-body"));
  focus(ctx, body, "body-focus", 0, 0.75, -0.01);

  const head = new Group();
  head.position.set(0, 1.17, 0.24);
  body.add(head);
  const cranium = loft([
    [-0.37, 0.12, 0.13, 0.12], [-0.29, 0.29, 0.27, 0.10], [-0.13, 0.44, 0.34, 0.02],
    [0.10, 0.51, 0.38], [0.32, 0.46, 0.34, -0.04], [0.49, 0.30, 0.26, -0.07], [0.56, 0.035, 0.04, -0.08],
  ], wet, 48);
  head.add(named(cranium, "cranium"));
  for (const side of [-1, 1]) {
    // Deep folds around two pin-sized black eyes, no muzzle or animal nose.
    head.add(place(ball(1, fold, 0.10, 0.055, 0.033, 20), side * 0.265, 0.04, 0.34));
    head.add(place(ball(0.022, mats.eye, 1, 0.85, 0.65, 20), side * 0.26, 0.04, 0.371));
    surfaceTendon(cranium, [v(side * .08, .025, .36), v(side * .22, .09, .36), v(side * .39, .15, .29)], [.038, .03, .006], wet);
    surfaceTendon(cranium, [v(side * .09, -.13, .37), v(side * .22, -.15, .33), v(side * .26, -.28, .25)], [.019, .025, .005], fold);
  }
  head.add(place(ball(1, mats.dark, 0.12, 0.084, 0.018, 24), 0, -0.22, 0.371));
  for(const side of [-1,1]) head.add(tendon([v(-.115,-.22,.381),v(-.065,-.22+side*.068,.39),v(.06,-.22+side*.063,.39),v(.115,-.22,.381)], [.014,.019,.018,.01],slime,28));
  for (let i = 0; i < 15; i++) {
    const a = i / 15 * Math.PI * 2;
    const x = Math.cos(a) * .10, y = -.22 + Math.sin(a) * .062;
    head.add(tendon([v(x, y, .386), v(x * .8, -.22 + (y + .22) * .70, .404), v(x * .65, -.22 + (y + .22) * .48, .40)], [.009, .006, .0008], mats.accent, 8, 6));
  }
  // Greasy rivulets and skin folds conform to the surface rather than floating particles.
  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * .092;
    surfaceTendon(cranium, [v(x, .40, .23), v(x * 1.16, .24, .33), v(x * 1.12, .15, .369)], [.016, .012, .002], slime, v(0,0,1), 14);
  }
  for (const side of [-1, 1]) {
    const arm = new Group();
    arm.position.set(side * .38, .98, .02);
    body.add(arm);
    arm.add(tendon([v(0, 0, 0), v(side * .26, -.10, .03), v(side * .42, -.32, .17), v(side * .49, -.45, .47)], [.19, .18, .12, .095], wet, 40, 20));
    arm.add(tendon([v(side * .13, -.08, .17), v(side * .31, -.23, .27), v(side * .44, -.39, .47)], [.026, .03, .008], slime));
    const hand = named(new Group(), side === 1 ? "grasping-claw-right" : "grasping-claw-left");
    hand.position.set(side * .49, -.45, .49);
    arm.add(hand);
    hand.add(place(ball(1, wet, .155, .13, .14, 28), 0, -.01, .04));
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * .076;
      const tip = .26 + Math.sin(i * 1.2) * .035;
      hand.add(tendon([v(x, -.025, .11), v(x * 1.25, -.07, .23), v(x * 1.13, -.18, tip), v(x * .96, -.25, .20)], [.043, .035, .024, .012], wet));
      hand.add(tendon([v(x * .96, -.25, .20), v(x * .87, -.28, .14), v(x * .7, -.25, .08)], [.017, .012, .0008], mats.accent, 14));
    }
    hand.add(tendon([v(-side * .12, .02, .06), v(-side * .24, -.07, .13), v(-side * .19, -.19, .19)], [.06, .045, .018], wet));
    tick(ctx, time => { arm.rotation.y = side * .025 * Math.sin(time * .8 + ctx.phase); hand.rotation.x = .04 * Math.sin(time + side); });

    // Two squat hind limbs; this source has two grasping claws, not eyestalks.
    body.add(tendon([v(side * .29, .40, -.20), v(side * .52, .27, -.26), v(side * .47, .09, .04)], [.19, .16, .08], wet, 30, 18));
    body.add(place(ball(1, wet, .15, .085, .21, 24), side * .47, .075, .11));
    for (let i = -1; i <= 1; i++) {
      const x = side * .47 + i * .09;
      body.add(tendon([v(x, .06, .22), v(x + i * .025, .055, .30), v(x + i * .03, .025, .34)], [.034, .027, .001], mats.accent, 12));
    }
    for (let i = 0; i < 4; i++) {
      const y = .42 + i * .13;
      surfaceTendon(trunk, [v(side * .18, y, .24), v(side * .30, y + .015, .29), v(side * .43, y + .07, .20)], [.017, .024, .002], fold);
    }
  }
  tick(ctx, time => {
    trunk.scale.x = 1 + .018 * Math.sin(time * 1.2 + ctx.phase);
    head.rotation.x = .022 * Math.sin(time * .8 + ctx.phase);
    head.rotation.y = .045 * Math.sin(time * .55);
  });
  // Surface pigmentation: dark crimson veins beneath the icy glossy film.
  body.traverse(object => {
    if (!(object instanceof Mesh) || object.material !== wet) return;
    const p=object.geometry.getAttribute("position"), colors: number[]=[];
    const color=new Color();
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
      const m=Math.sin(x*28+Math.sin(y*19+z*13)*1.8)*Math.sin(y*24-z*21);
      const shade=.68+.21*m;
      color.setRGB(shade,shade*.84,shade*.88);
      colors.push(color.r,color.g,color.b);
    }
    object.geometry.setAttribute("color",new Float32BufferAttribute(colors,3));
  });
}

export function buildKobold(ctx: Ctx): void {
  const { root, mats } = ctx;
  mats.skin.flatShading = false;
  mats.belly.flatShading = false;
  const leather = new MeshStandardMaterial({ color: "#493329", roughness: .94 });
  const ridge = new MeshStandardMaterial({ color: "#713823", roughness: .65 });
  const body = new Group();
  root.add(body);
  const torso = named(loft([
    [.64, .11, .085, -.02], [.77, .14, .09], [.93, .16, .105, .015],
    [1.10, .21, .125, .035], [1.19, .19, .105, .07], [1.27, .075, .06, .10],
  ], mats.skin), "main-body");
  body.add(torso);
  // Layered ventral scutes, not mammalian fur or a dog nose.
  for (let i = 0; i < 6; i++) {
    const y = .77 + i * .071;
    body.add(place(ball(1, mats.belly, .12 + i * .008, .046, .021, 18), 0, y, .102 + i * .01));
  }
  const pelvis = new Group();
  body.add(pelvis);
  const loincloth = panel([[-.17,.75],[.17,.75],[.12,.49],[0,.43],[-.12,.49]], .012, leather);
  loincloth.position.z = .105;
  pelvis.add(loincloth);
  const belt = torus(.153, .024, leather, Math.PI * 2, 8, 32);
  belt.rotation.x = Math.PI / 2;
  belt.scale.z = .7;
  belt.position.y = .75;
  body.add(belt, place(box(.06, .04, .025, mats.metal), 0, .75, .14));
  const strapPoints = Array.from({ length: 9 }, (_, i) => v(-.17 + i / 8 * .27, 1.18 - i / 8 * .40, .14));
  surfaceTendon(torso, strapPoints, strapPoints.map(() => .018), leather);
  body.add(place(ball(1, leather, .08, .10, .055, 16), -.19, .71, .01));

  for (const side of [-1, 1]) {
    // Bent knee and raised hock give the creature a digitigrade silhouette.
    body.add(tendon([v(side * .10, .68, -.01), v(side * .16, .45, .085), v(side * .17, .20, -.08), v(side * .19, .07, .06)], [.078, .066, .032, .03], mats.skin, 32, 14));
    body.add(place(ball(1, mats.skin, .055, .042, .105, 20), side * .19, .047, .10));
    for (let i = -1; i <= 1; i++) {
      const x = side * .19 + i * .043;
      body.add(tendon([v(x,.04,.14), v(x + i * .009,.039,.22), v(x + i * .015,.023,.27)], [.025,.018,.001], mats.accent, 12, 8));
    }
  }
  const tail = new Group();
  tail.position.set(0,.67,-.055);
  const tailPoints = [v(0,0,0),v(.06,-.17,-.30),v(.29,-.28,-.65),v(.48,-.19,-.92),v(.53,-.08,-1.02)];
  const tailSkin = named(tendon(tailPoints, [.083,.068,.045,.024,.001], mats.skin, 56, 16), "tail-skin");
  tail.add(tailSkin);
  body.add(tail);
  const tailCurve = new CatmullRomCurve3(tailPoints);
  for (let i = 0; i < 7; i++) {
    const u = i / 6;
    const scute = named(ball(.034 * (1 - u * .7), ridge, 1,.4,1.4,10), `tail-scute-${i}`);
    mountSurface(tailSkin, scute, tailCurve.getPointAt(.10 + u * .76), v(0,1,0), .002);
  }
  tick(ctx, time => { tail.rotation.y = .065 * Math.sin(time * 1.3 + ctx.phase); });

  const head = focus(ctx, body, "head-focus", 0, 1.36, .12);
  const skull = loft([
    [-.15,.11,.09,.015],[-.09,.17,.12],[.04,.18,.15], [.16,.15,.13,-.015],[.23,.035,.04,-.04],
  ], mats.skin, 36);
  head.add(skull);
  const muzzle = loft([[-.10,.085,.17,.17],[-.06,.115,.185,.16],[.025,.13,.17,.12],[.08,.10,.12,.07]], mats.skin, 24);
  head.add(named(muzzle,"reptilian-jaw"));
  head.add(place(ball(1, mats.dark, .104, .009, .155, 24), 0, -.095, .18));
  head.add(place(ball(1, mats.belly, .095, .032, .16, 24), 0, -.127, .16));
  for (const side of [-1, 1]) {
    const eye = place(ball(1, mats.eye, .054, .039, .015, 24), side * .145, .056, .116);
    eye.rotation.y = side * .65;
    const slit = place(ball(1, mats.dark, .007, .031, .012, 18), side * .152, .057, .127);
    slit.rotation.y = side * .65;
    head.add(eye,slit);
    head.add(tendon([v(side * .075,.125,.115),v(side * .15,.112,.13),v(side * .195,.074,.055)], [.032,.027,.006], ridge));
    // Two inset nostrils in the snout, not a black mammalian nose.
    head.add(place(ball(1, mats.dark, .013,.008,.005,16), side * .074, -.005, .326));
    head.add(tendon([v(side*.105,.16,-.035),v(side*.155,.26,-.075),v(side*.19,.33,-.15)], [.043,.025,.001], mats.accent));
    const ear = panel([[0,0],[side*.16,.08],[side*.11,-.10]], .012, ridge);
    ear.position.set(side*.14,.03,-.07);
    ear.rotation.y = side * .3;
    head.add(ear);
    for (let i = 0; i < 4; i++) head.add(tendon([v(side*.086,-.09,.12 + i*.044), v(side*.088,-.12,.13 + i*.044)], [.007,.0008], mats.accent, 6, 6));
  }
  for (let i = 0; i < 4; i++) {
    const scute = panel([[-.023,0],[0,.045],[.023,0],[0,-.035]], .01, ridge);
    scute.position.set(0, .13 - i * .05, -.13);
    head.add(scute);
  }

  const right = new Group();
  right.position.set(.19,1.16,.04);
  body.add(right);
  right.add(tendon([v(0,0,0),v(.15,-.15,.03),v(.15,-.29,.25)], [.057,.045,.029], mats.skin, 28, 14));
  const grip = named(place(new Group(),.15,-.29,.25), "dagger-grip");
  right.add(grip);
  grip.add(ball(.041,mats.skin,1,1.2,.8,20));
  const dagger = named(new Group(),"dagger");
  dagger.rotation.set(.12,0,-.35);
  const blade = panel([[-.031,.045],[-.043,.18],[0,.43],[.043,.18],[.031,.045]], .012, mats.metal,.003);
  dagger.add(blade,place(box(.14,.025,.027,mats.metal),0,.045,0),place(cyl(.018,.018,.12,leather,12),0,-.02,0),place(ball(.024,mats.accent,1,1,1,12),0,-.09,0));
  grip.add(dagger);
  for (let i = 0; i < 3; i++) grip.add(tendon([v(-.034,-.03+i*.021,.02),v(.018,-.03+i*.021,.032),v(.025,-.03+i*.021,-.01)], [.014,.012,.005], mats.skin,14,8));
  const left = new Group();
  left.position.set(-.19,1.16,.04);
  left.add(tendon([v(0,0,0),v(-.13,-.21,-.01),v(-.09,-.41,.15)], [.057,.045,.029], mats.skin,28,14));
  left.add(place(ball(.04,mats.skin,1,1.1,.8,18),-.09,-.41,.15));
  const sling = named(new Group(),"sling");
  sling.position.set(-.09,-.41,.17);
  for (const side of [-1,1]) sling.add(tendon([v(side*.012,0,0),v(side*.033,-.13,.01),v(side*.048,-.24,.015)], [.005,.005,.005],leather,20,6));
  sling.add(place(ball(1,leather,.055,.04,.024,16),0,-.24,.01));
  left.add(sling);
  body.add(left);
  tick(ctx, time => {
    head.rotation.y = .09 * Math.sin(time * .7 + ctx.phase);
    head.rotation.x = -.05 + .018 * Math.sin(time * 1.6);
    body.scale.y = 1 + .007 * Math.sin(time * 2 + ctx.phase);
    right.rotation.x = .04 * Math.sin(time * 1.2);
    left.rotation.x = .03 * Math.sin(time * 1.4 + 1);
  });
}

function feather(length: number, width: number, mat: Material): Mesh {
  // A cambered leaf profile with a pointed tip and a distinct central shaft.
  const outline = [[0,0],[-width*.30,-length*.12],[-width*.55,-length*.40],[-width*.38,-length*.78],[0,-length],[width*.33,-length*.74],[width*.45,-length*.35],[width*.20,-length*.10]];
  return panel(outline,.012,mat,.004);
}

export function buildPlanetar(ctx: Ctx): void {
  const { root, mats } = ctx;
  const gold = new MeshStandardMaterial({ color: "#d0a758", roughness: .35, metalness: .72 });
  const featherMat = new MeshStandardMaterial({ color: "#eee8d5", roughness: .9 });
  const featherShade = new MeshStandardMaterial({ color: "#bdc8c0", roughness: .92 });
  const steel = new MeshStandardMaterial({ color: "#b9d4d7", roughness: .27, metalness: .82 });
  const body = new Group();
  root.add(body);
  const torso = named(loft([
    [.90,.145,.10],[1.03,.17,.125],[1.18,.18,.125],[1.35,.235,.145],
    [1.51,.295,.165],[1.65,.30,.135],[1.72,.22,.10],[1.78,.065,.06],
  ], mats.skin,40),"main-body");
  body.add(torso);
  // Anatomical planes: clavicles, sternum, paired pectorals, abdominal plates.
  for (const side of [-1,1]) {
    body.add(place(ball(1,mats.skin,.128,.084,.047,28),side*.13,1.53,.144));
    body.add(tendon([v(0,1.66,.11),v(side*.16,1.65,.135),v(side*.28,1.60,.065)], [.018,.019,.008],mats.belly));
    for (let i=0;i<3;i++) body.add(place(ball(1,mats.belly,.068,.044,.018,20),side*.073,1.36-i*.079,.128-i*.004));
    body.add(tendon([v(side*.10,.95,0),v(side*.16,.64,.04),v(side*.17,.39,-.025),v(side*.18,.095,.005)], [.10,.09,.06,.046],mats.skin,40,18));
    body.add(place(ball(1,mats.skin,.062,.047,.145,24),side*.18,.048,.085));
    const boot = loft([[.09,.052,.065],[.17,.064,.056],[.35,.074,.056],[.47,.057,.048]], mats.cloth,24);
    boot.position.set(side*.17,0,-.018);
    body.add(boot);
    for (const y of [.13,.39]) {
      const band=torus(.063,.009,gold,Math.PI*2,8,24);
      band.rotation.x=Math.PI/2;band.scale.z=.83;band.position.set(side*.17,y,-.018);body.add(band);
    }
  }
  const skirt = new Group();
  skirt.position.y=.97;
  body.add(skirt);
  for (const side of [-1,1]) {
    const cloth=panel([[side*.01,0],[side*.17,.015],[side*.26,-.40],[side*.075,-.47]],.013,mats.cloth);
    cloth.position.z=.145;
    skirt.add(cloth);
    skirt.add(tendon([v(side*.08,-.02,.16),v(side*.115,-.19,.16),v(side*.14,-.43,.16)], [.009,.009,.009],gold,24,6));
  }
  const belt=torus(.17,.025,gold,Math.PI*2,10,40);
  belt.rotation.x=Math.PI/2;belt.scale.z=.78;belt.position.y=.99;
  body.add(belt,place(ball(.04,gold,1,1,.35,20),0,.99,.17));

  const head=focus(ctx,body,"head-focus",0,1.94,.012);
  head.add(named(loft([
    [-.145,.036,.040,.05],[-.117,.068,.063,.035],[-.064,.084,.077,.02],
    [.015,.091,.078],[.095,.087,.078,-.008],[.145,.068,.064,-.01],[.164,.010,.015,-.01],
  ],mats.skin,40),"human-face"));
  // A humanoid nose bridge, cheekbones, chin and inset luminous eyes.
  head.add(place(loft([[-.055,.019,.018,.084],[.005,.013,.021,.076],[.055,.012,.010,.064]],mats.belly,16),0,0,0));
  for (const side of [-1,1]) {
    head.add(place(ball(1,mats.eye,.025,.010,.008,24),side*.038,.021,.073));
    head.add(tendon([v(side*.012,.050,.071),v(side*.038,.052,.074),v(side*.065,.037,.061)],[.009,.011,.004],mats.skin));
    head.add(place(ball(1,mats.belly,.026,.022,.013,24),side*.053,-.029,.066));
    head.add(place(ball(1,mats.skin,.016,.032,.012,20),side*.089,-.006,.002));
  }
  head.add(place(box(.055,.004,.005,mats.dark),0,-.076,.070));
  head.add(place(ball(1,mats.belly,.032,.016,.013,24),0,-.105,.057));
  // Bald, green-skinned celestial; a narrow diadem rather than an animal snout.
  const diadem=torus(.087,.005,gold,Math.PI*2,8,40);
  diadem.rotation.x=Math.PI/2;diadem.position.y=.092;
  head.add(diadem,place(ball(.011,gold,1,1.5,.4,16),0,.097,.075));

  for (const side of [-1,1]) {
    const wing=named(new Group(),side===1?"wing-right":"wing-left");
    wing.position.set(side*.20,1.59,-.10);
    wing.scale.x=side;
    body.add(wing);
    const wingPoints = [v(0,0,0),v(.32,.35,-.05),v(.66,.60,-.12),v(1.03,.58,-.15)];
    const support = tendon(wingPoints, [.085,.065,.043,.02],featherShade,36,14);
    wing.add(support);
    const wingCurve = new CatmullRomCurve3(wingPoints);
    // Separate overlapping primary and secondary feather rows, on both sides.
    for (let row=0;row<3;row++) for (let i=0;i<12;i++) {
      const u=i/11;
      const length=(row===0?.70:row===1?.42:.23)*(0.70+u*.55);
      const f=feather(length,row===0?.115:row===1?.12:.105,(i+row)%3===0?featherShade:featherMat);
      f.rotation.z=.08+u*.95;
      f.rotation.y=-.10-u*.18;
      const featherRoot = named(new Group(), "wing-feather-root");
      const plane = new Group(); plane.rotation.x=-Math.PI/2; plane.add(f); featherRoot.add(plane);
      mountSurface(support, featherRoot, wingCurve.getPointAt(.10+u*.84), v(0,0,1), .022-row*.010);
      if(row===0){
        const shaft=tendon([v(0,-.03,.012),v(0,-length*.42,.014),v(0,-length*.87,.01)],[.004,.003,.001],featherShade,16,6);
        f.add(shaft);
      }
    }
    wing.rotation.y=-.18;
    tick(ctx,time=>{wing.rotation.y=-.18+.028*Math.sin(time*.9+ctx.phase);wing.rotation.z=side*.02*Math.sin(time*.7);});
  }

  // The entire two-handed pose shares one rig: wrists cannot drift off the hilt.
  const arms=new Group();
  body.add(arms);
  const sword=named(place(new Group(),.39,1.17,.34),"greatsword");
  sword.rotation.z=.14;
  arms.add(sword);
  const blade=loft([[-1.05,.001,.001],[-.93,.067,.012],[-.18,.076,.018],[-.075,.092,.022]],steel,4);
  blade.name="greatsword-blade";
  sword.add(blade);
  sword.add(place(box(.40,.045,.06,gold),0,-.033,0));
  for(const side of [-1,1]) sword.add(tendon([v(side*.14,-.033,0),v(side*.22,-.018,0),v(side*.25,.018,0)],[.024,.020,.009],gold,16));
  sword.add(place(cyl(.021,.023,.36,mats.dark,16),0,.18,0),place(ball(.037,gold,1,1.25,1,24),0,.395,0));
  for(let i=0;i<11;i++){
    const ring=torus(.024,.003,gold,Math.PI*2,6,16);ring.rotation.x=Math.PI/2;ring.position.y=.025+i*.03;sword.add(ring);
  }
  sword.add(tendon([v(0,-.15,.024),v(0,-.56,.017),v(0,-.89,.015)],[.004,.004,.002],mats.glow,24,6));
  sword.updateMatrix();
  for(const [side,gripY] of [[1,.10],[-1,.28]]){
    const hand=v(0,gripY!,0).applyMatrix4(sword.matrix);
    const shoulder=v(side!*.28,1.60,.015);
    const elbow=side===1?v(.48,1.32,.11):v(-.28,1.24,.22);
    arms.add(tendon([shoulder,elbow,hand],[.075,.064,.035],mats.skin,36,16));
    const cuff=cyl(.060,.050,.10,gold,20);
    cuff.position.copy(hand.clone().lerp(elbow,.15));
    cuff.quaternion.setFromUnitVectors(v(0,1,0),elbow.clone().sub(hand).normalize());
    arms.add(cuff);
    const palm=named(place(new Group(),0,gripY!,0),side===1?"right-grip":"left-grip");
    sword.add(palm);
    palm.add(place(ball(1,mats.skin,.04,.038,.045,24),0,0,-.01));
    for(let i=0;i<4;i++){
      const y=(i-1.5)*.016;
      palm.add(tendon([v(-.028,y,0),v(-.018,y,.028),v(.018,y,.029),v(.029,y,.004)],[.010,.009,.009,.006],mats.skin,20,8));
    }
    palm.add(tendon([v(.026,-.023,-.018),v(.035,-.008,.014),v(.009,.006,.028)],[.013,.010,.006],mats.skin,18,8));
  }
  tick(ctx,time=>{
    const breath=Math.sin(time*1.3+ctx.phase);
    torso.scale.x=1+.006*breath;
    arms.position.y=.003*breath;
    head.rotation.y=.055*Math.sin(time*.45+ctx.phase);
    skirt.rotation.x=.014*Math.sin(time*1.1);
  });
}
