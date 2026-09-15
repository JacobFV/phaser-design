; ModuleID = 'kernels.c'
source_filename = "kernels.c"
target datalayout = "e-m:o-i64:64-i128:128-n32:64-S128-Fn32"
target triple = "arm64-apple-macosx26.0.0"

; Function Attrs: noinline nounwind ssp uwtable(sync)
define zeroext i8 @step(i8 noundef signext %0, i8 noundef zeroext %1) #0 {
  %3 = alloca i8, align 1
  %4 = alloca i8, align 1
  store i8 %0, ptr %3, align 1
  store i8 %1, ptr %4, align 1
  %5 = load i8, ptr %3, align 1
  %6 = sext i8 %5 to i32
  %7 = icmp sgt i32 %6, 0
  br i1 %7, label %8, label %15

8:                                                ; preds = %2
  %9 = load i8, ptr %4, align 1
  %10 = zext i8 %9 to i32
  %11 = icmp slt i32 %10, 255
  br i1 %11, label %12, label %15

12:                                               ; preds = %8
  %13 = load i8, ptr %4, align 1
  %14 = add i8 %13, 1
  store i8 %14, ptr %4, align 1
  br label %27

15:                                               ; preds = %8, %2
  %16 = load i8, ptr %3, align 1
  %17 = sext i8 %16 to i32
  %18 = icmp slt i32 %17, 0
  br i1 %18, label %19, label %26

19:                                               ; preds = %15
  %20 = load i8, ptr %4, align 1
  %21 = zext i8 %20 to i32
  %22 = icmp sgt i32 %21, 0
  br i1 %22, label %23, label %26

23:                                               ; preds = %19
  %24 = load i8, ptr %4, align 1
  %25 = add i8 %24, -1
  store i8 %25, ptr %4, align 1
  br label %26

26:                                               ; preds = %23, %19, %15
  br label %27

27:                                               ; preds = %26, %12
  %28 = load i8, ptr %4, align 1
  ret i8 %28
}

; Function Attrs: noinline nounwind ssp uwtable(sync)
define zeroext i8 @parity(i8 noundef zeroext %0) #0 {
  %2 = alloca i8, align 1
  store i8 %0, ptr %2, align 1
  %3 = load i8, ptr %2, align 1
  %4 = zext i8 %3 to i32
  %5 = ashr i32 %4, 4
  %6 = load i8, ptr %2, align 1
  %7 = zext i8 %6 to i32
  %8 = xor i32 %7, %5
  %9 = trunc i32 %8 to i8
  store i8 %9, ptr %2, align 1
  %10 = load i8, ptr %2, align 1
  %11 = zext i8 %10 to i32
  %12 = ashr i32 %11, 2
  %13 = load i8, ptr %2, align 1
  %14 = zext i8 %13 to i32
  %15 = xor i32 %14, %12
  %16 = trunc i32 %15 to i8
  store i8 %16, ptr %2, align 1
  %17 = load i8, ptr %2, align 1
  %18 = zext i8 %17 to i32
  %19 = ashr i32 %18, 1
  %20 = load i8, ptr %2, align 1
  %21 = zext i8 %20 to i32
  %22 = xor i32 %21, %19
  %23 = trunc i32 %22 to i8
  store i8 %23, ptr %2, align 1
  %24 = load i8, ptr %2, align 1
  %25 = zext i8 %24 to i32
  %26 = and i32 %25, 1
  %27 = trunc i32 %26 to i8
  ret i8 %27
}

; Function Attrs: noinline nounwind ssp uwtable(sync)
define zeroext i8 @gcd8(i8 noundef zeroext %0, i8 noundef zeroext %1) #0 {
  %3 = alloca i8, align 1
  %4 = alloca i8, align 1
  %5 = alloca i8, align 1
  store i8 %0, ptr %3, align 1
  store i8 %1, ptr %4, align 1
  br label %6

6:                                                ; preds = %10, %2
  %7 = load i8, ptr %4, align 1
  %8 = zext i8 %7 to i32
  %9 = icmp ne i32 %8, 0
  br i1 %9, label %10, label %19

10:                                               ; preds = %6
  %11 = load i8, ptr %3, align 1
  %12 = zext i8 %11 to i32
  %13 = load i8, ptr %4, align 1
  %14 = zext i8 %13 to i32
  %15 = srem i32 %12, %14
  %16 = trunc i32 %15 to i8
  store i8 %16, ptr %5, align 1
  %17 = load i8, ptr %4, align 1
  store i8 %17, ptr %3, align 1
  %18 = load i8, ptr %5, align 1
  store i8 %18, ptr %4, align 1
  br label %6, !llvm.loop !6

19:                                               ; preds = %6
  %20 = load i8, ptr %3, align 1
  ret i8 %20
}

; Function Attrs: noinline nounwind ssp uwtable(sync)
define zeroext i8 @gcd8_sub(i8 noundef zeroext %0, i8 noundef zeroext %1, ptr noundef %2) #0 {
  %4 = alloca i8, align 1
  %5 = alloca i8, align 1
  %6 = alloca i8, align 1
  %7 = alloca ptr, align 8
  %8 = alloca i32, align 4
  store i8 %0, ptr %5, align 1
  store i8 %1, ptr %6, align 1
  store ptr %2, ptr %7, align 8
  store i32 0, ptr %8, align 4
  %9 = load i8, ptr %5, align 1
  %10 = zext i8 %9 to i32
  %11 = icmp eq i32 %10, 0
  br i1 %11, label %12, label %15

12:                                               ; preds = %3
  %13 = load ptr, ptr %7, align 8
  store i32 0, ptr %13, align 4
  %14 = load i8, ptr %6, align 1
  store i8 %14, ptr %4, align 1
  br label %47

15:                                               ; preds = %3
  br label %16

16:                                               ; preds = %40, %15
  %17 = load i8, ptr %6, align 1
  %18 = zext i8 %17 to i32
  %19 = icmp ne i32 %18, 0
  br i1 %19, label %20, label %43

20:                                               ; preds = %16
  %21 = load i8, ptr %5, align 1
  %22 = zext i8 %21 to i32
  %23 = load i8, ptr %6, align 1
  %24 = zext i8 %23 to i32
  %25 = icmp sgt i32 %22, %24
  br i1 %25, label %26, label %33

26:                                               ; preds = %20
  %27 = load i8, ptr %5, align 1
  %28 = zext i8 %27 to i32
  %29 = load i8, ptr %6, align 1
  %30 = zext i8 %29 to i32
  %31 = sub nsw i32 %28, %30
  %32 = trunc i32 %31 to i8
  store i8 %32, ptr %5, align 1
  br label %40

33:                                               ; preds = %20
  %34 = load i8, ptr %6, align 1
  %35 = zext i8 %34 to i32
  %36 = load i8, ptr %5, align 1
  %37 = zext i8 %36 to i32
  %38 = sub nsw i32 %35, %37
  %39 = trunc i32 %38 to i8
  store i8 %39, ptr %6, align 1
  br label %40

40:                                               ; preds = %33, %26
  %41 = load i32, ptr %8, align 4
  %42 = add nsw i32 %41, 1
  store i32 %42, ptr %8, align 4
  br label %16, !llvm.loop !8

43:                                               ; preds = %16
  %44 = load i32, ptr %8, align 4
  %45 = load ptr, ptr %7, align 8
  store i32 %44, ptr %45, align 4
  %46 = load i8, ptr %5, align 1
  store i8 %46, ptr %4, align 1
  br label %47

47:                                               ; preds = %43, %12
  %48 = load i8, ptr %4, align 1
  ret i8 %48
}

attributes #0 = { noinline nounwind ssp uwtable(sync) "frame-pointer"="non-leaf" "no-trapping-math"="true" "probe-stack"="__chkstk_darwin" "stack-protector-buffer-size"="8" "target-cpu"="apple-m1" "target-features"="+aes,+altnzcv,+bti,+ccdp,+ccidx,+complxnum,+crc,+dit,+dotprod,+flagm,+fp-armv8,+fp16fml,+fptoint,+fullfp16,+jsconv,+lse,+neon,+pauth,+perfmon,+predres,+ras,+rcpc,+rdm,+sb,+sha2,+sha3,+specrestrict,+ssbs,+v8.1a,+v8.2a,+v8.3a,+v8.4a,+v8.5a,+v8a,+zcm,+zcz" }

!llvm.module.flags = !{!0, !1, !2, !3, !4}
!llvm.ident = !{!5}

!0 = !{i32 2, !"SDK Version", [2 x i32] [i32 26, i32 2]}
!1 = !{i32 1, !"wchar_size", i32 4}
!2 = !{i32 8, !"PIC Level", i32 2}
!3 = !{i32 7, !"uwtable", i32 1}
!4 = !{i32 7, !"frame-pointer", i32 1}
!5 = !{!"Apple clang version 17.0.0 (clang-1700.6.3.2)"}
!6 = distinct !{!6, !7}
!7 = !{!"llvm.loop.mustprogress"}
!8 = distinct !{!8, !7}
