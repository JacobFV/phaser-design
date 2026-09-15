; ModuleID = 'kernels.c'
source_filename = "kernels.c"
target datalayout = "e-m:o-i64:64-i128:128-n32:64-S128-Fn32"
target triple = "arm64-apple-macosx26.0.0"

; Function Attrs: mustprogress nofree noinline norecurse nosync nounwind ssp willreturn memory(none) uwtable(sync)
define noundef zeroext i8 @step(i8 noundef signext %0, i8 noundef zeroext %1) local_unnamed_addr #0 {
  %3 = icmp sgt i8 %0, 0
  %4 = icmp ne i8 %1, -1
  %5 = and i1 %3, %4
  br i1 %5, label %6, label %8

6:                                                ; preds = %2
  %7 = add i8 %1, 1
  br label %14

8:                                                ; preds = %2
  %9 = icmp slt i8 %0, 0
  %10 = icmp ne i8 %1, 0
  %11 = and i1 %9, %10
  %12 = sext i1 %11 to i8
  %13 = add i8 %12, %1
  br label %14

14:                                               ; preds = %8, %6
  %15 = phi i8 [ %7, %6 ], [ %13, %8 ]
  ret i8 %15
}

; Function Attrs: mustprogress nofree noinline norecurse nosync nounwind ssp willreturn memory(none) uwtable(sync)
define zeroext range(i8 0, 2) i8 @parity(i8 noundef zeroext %0) local_unnamed_addr #0 {
  %2 = lshr i8 %0, 4
  %3 = xor i8 %2, %0
  %4 = lshr i8 %3, 2
  %5 = xor i8 %4, %3
  %6 = lshr i8 %5, 1
  %7 = xor i8 %6, %5
  %8 = and i8 %7, 1
  ret i8 %8
}

; Function Attrs: nofree noinline norecurse nosync nounwind ssp memory(none) uwtable(sync)
define zeroext i8 @gcd8(i8 noundef zeroext %0, i8 noundef zeroext %1) local_unnamed_addr #1 {
  %3 = icmp eq i8 %1, 0
  br i1 %3, label %9, label %4

4:                                                ; preds = %2, %4
  %5 = phi i8 [ %6, %4 ], [ %0, %2 ]
  %6 = phi i8 [ %7, %4 ], [ %1, %2 ]
  %7 = urem i8 %5, %6
  %8 = icmp eq i8 %7, 0
  br i1 %8, label %9, label %4, !llvm.loop !6

9:                                                ; preds = %4, %2
  %10 = phi i8 [ %0, %2 ], [ %6, %4 ]
  ret i8 %10
}

; Function Attrs: nofree noinline norecurse nosync nounwind ssp memory(argmem: write) uwtable(sync)
define zeroext i8 @gcd8_sub(i8 noundef zeroext %0, i8 noundef zeroext %1, ptr nocapture noundef writeonly %2) local_unnamed_addr #2 {
  %4 = icmp eq i8 %0, 0
  br i1 %4, label %18, label %5

5:                                                ; preds = %3
  %6 = icmp eq i8 %1, 0
  br i1 %6, label %18, label %7

7:                                                ; preds = %5, %7
  %8 = phi i32 [ %16, %7 ], [ 0, %5 ]
  %9 = phi i8 [ %15, %7 ], [ %1, %5 ]
  %10 = phi i8 [ %13, %7 ], [ %0, %5 ]
  %11 = icmp ugt i8 %10, %9
  %12 = select i1 %11, i8 %9, i8 0
  %13 = sub i8 %10, %12
  %14 = select i1 %11, i8 0, i8 %10
  %15 = sub i8 %9, %14
  %16 = add nuw nsw i32 %8, 1
  %17 = icmp eq i8 %15, 0
  br i1 %17, label %18, label %7, !llvm.loop !9

18:                                               ; preds = %7, %5, %3
  %19 = phi i32 [ 0, %3 ], [ 0, %5 ], [ %16, %7 ]
  %20 = phi i8 [ %1, %3 ], [ %0, %5 ], [ %13, %7 ]
  store i32 %19, ptr %2, align 4, !tbaa !10
  ret i8 %20
}

attributes #0 = { mustprogress nofree noinline norecurse nosync nounwind ssp willreturn memory(none) uwtable(sync) "frame-pointer"="non-leaf" "no-trapping-math"="true" "probe-stack"="__chkstk_darwin" "stack-protector-buffer-size"="8" "target-cpu"="apple-m1" "target-features"="+aes,+altnzcv,+bti,+ccdp,+ccidx,+complxnum,+crc,+dit,+dotprod,+flagm,+fp-armv8,+fp16fml,+fptoint,+fullfp16,+jsconv,+lse,+neon,+pauth,+perfmon,+predres,+ras,+rcpc,+rdm,+sb,+sha2,+sha3,+specrestrict,+ssbs,+v8.1a,+v8.2a,+v8.3a,+v8.4a,+v8.5a,+v8a,+zcm,+zcz" }
attributes #1 = { nofree noinline norecurse nosync nounwind ssp memory(none) uwtable(sync) "frame-pointer"="non-leaf" "no-trapping-math"="true" "probe-stack"="__chkstk_darwin" "stack-protector-buffer-size"="8" "target-cpu"="apple-m1" "target-features"="+aes,+altnzcv,+bti,+ccdp,+ccidx,+complxnum,+crc,+dit,+dotprod,+flagm,+fp-armv8,+fp16fml,+fptoint,+fullfp16,+jsconv,+lse,+neon,+pauth,+perfmon,+predres,+ras,+rcpc,+rdm,+sb,+sha2,+sha3,+specrestrict,+ssbs,+v8.1a,+v8.2a,+v8.3a,+v8.4a,+v8.5a,+v8a,+zcm,+zcz" }
attributes #2 = { nofree noinline norecurse nosync nounwind ssp memory(argmem: write) uwtable(sync) "frame-pointer"="non-leaf" "no-trapping-math"="true" "probe-stack"="__chkstk_darwin" "stack-protector-buffer-size"="8" "target-cpu"="apple-m1" "target-features"="+aes,+altnzcv,+bti,+ccdp,+ccidx,+complxnum,+crc,+dit,+dotprod,+flagm,+fp-armv8,+fp16fml,+fptoint,+fullfp16,+jsconv,+lse,+neon,+pauth,+perfmon,+predres,+ras,+rcpc,+rdm,+sb,+sha2,+sha3,+specrestrict,+ssbs,+v8.1a,+v8.2a,+v8.3a,+v8.4a,+v8.5a,+v8a,+zcm,+zcz" }

!llvm.module.flags = !{!0, !1, !2, !3, !4}
!llvm.ident = !{!5}

!0 = !{i32 2, !"SDK Version", [2 x i32] [i32 26, i32 2]}
!1 = !{i32 1, !"wchar_size", i32 4}
!2 = !{i32 8, !"PIC Level", i32 2}
!3 = !{i32 7, !"uwtable", i32 1}
!4 = !{i32 7, !"frame-pointer", i32 1}
!5 = !{!"Apple clang version 17.0.0 (clang-1700.6.3.2)"}
!6 = distinct !{!6, !7, !8}
!7 = !{!"llvm.loop.mustprogress"}
!8 = !{!"llvm.loop.unroll.disable"}
!9 = distinct !{!9, !7, !8}
!10 = !{!11, !11, i64 0}
!11 = !{!"int", !12, i64 0}
!12 = !{!"omnipotent char", !13, i64 0}
!13 = !{!"Simple C/C++ TBAA"}
