---
title: "力扣 912. 排序数组"
description: "随机选基准的快速排序（挖坑法）：一次划分把数组分成 ≤ 基准和 ≥ 基准两段，再分治递归；期望 O(n log n)。"
category: "practice"
tags: ["divide-and-conquer"]
published: "2026-11-23"
problem:
  platform: leetcode
  number: 912
  url: "https://leetcode.cn/problems/sort-an-array/"
  difficulty: medium
  exam: true
related: []
---

## 题意

手写排序算法，将数组变为升序，不能使用任何内置函数，时间复杂度为O(nlog(n))。

## 思路

### 解法

快速排序。我用的是挖坑法，思路参考B站 [【三分钟学会快速排序】](https://www.bilibili.com/video/BV1j841197rQ)

简单地说就是随机选中一个数当基准点，将这个数移到数组最左边，然后它所在的位置被设为空。

设置两个指针，左指针从最左端开始走，右指针从最右端开始走。开始的时候，左指针指着为空的位置，右指针往左走。

如果右指针指到的数大于基准点，右指针继续左移，左指针保持不动。

如果右指针指到的数小于等于基准点，就移到空位，此时右指针的位置变成空，左指针开始右移。

如果左指针指到的数小于基准点，左指针继续右移，右指针保持不动。

如果左指针指到的数大于等于基准点，就移到空位，此时左指针的位置变成空，右指针开始左移。

左右指针相遇的位置，就是基准点在这个数组中应该在的位置。

然后再对左右数组分开递归的进行处理。

## 代码

```python
import random

class Solution:
    def sortArray(self, nums: list[int]) -> list[int]:
        n = len(nums)
        
        def quicksort(left,right):
            l = left
            r = right
            blank = l

            if l >= r:
                return

            p = random.randint(left, right)
            nums[l], nums[p] = nums[p], nums[l]

            base = nums[l]
            while l < r:
                if blank == l: # 固定 l 动 r
                    if nums[r] > base:
                        r -= 1
                    else:
                        nums[l] = nums[r]
                        blank = r
                        l += 1
                elif blank == r:
                    if nums[l] < base:
                        l += 1
                    else:
                        nums[r] = nums[l]
                        blank = l
                        r -= 1
            nums[l] = base
            quicksort(left,l-1)
            quicksort(l+1,right)

        quicksort(0,n-1)
        return nums
```

## 复杂度

- 时间：期望 O(n log n)，最坏 O(n²)。随机选基准后，最坏情况的概率极小。
- 空间：原地排序，额外空间只有递归栈，期望 O(log n)，最坏 O(n)。

### 为什么平均是 O(n log n)，最坏是 O(n²)

把递归过程画成一棵树：根是整个数组，每次划分产生左右两个子数组作为孩子。

**每一层的总工作量是 O(n)。** 一次划分里，区间内每个数都只和基准比较一次、最多搬一次，代价和区间长度成正比。同一层的所有子数组互不重叠，长度加起来不超过 n，所以不管怎么切，每一层合计都是 O(n)。于是：

$$
\text{总时间} = \text{每层 } O(n) \times \text{层数}
$$

时间复杂度完全取决于递归树有多深。

**最好情况：每次正好对半分。** 第 0 层 1 个长度 n 的数组，第 1 层 2 个长度 n/2，第 2 层 4 个长度 n/4……第 k 层子数组长度是 $n/2^k$。长度降到 1 就停，$n/2^k = 1$ 解出 $k = \log_2 n$。一共 log n 层，每层 n，总共 O(n log n)。

**不需要每次都对半分。** 就算每次都切成 1:9 这么偏，大的那边每层也会缩到原来的 9/10，长度降到 1 需要 $\log_{10/9} n$ 层。换底以后 $\log_{10/9} n = \log_2 n / \log_2(10/9) \approx 6.6 \log_2 n$，仍然是 O(log n) 层，只是常数大了一点。所以只要每次切分的比例不是越来越偏，深度就是 O(log n)，总时间就是 O(n log n)。

**随机选基准为什么能保证平均是这样。** 把区间按大小排名分成四段，基准的排名落在中间两段（第 25% 到 75% 之间）的概率是 1/2。落在这里叫一次"好划分"，两边都不超过原来的 3/4。

盯住任意一个数 x 看：x 每经过一次好划分，它所在的子数组就缩到至多 3/4，经过 $\log_{4/3} n$ 次好划分就只剩它自己。每次划分是好划分的概率是 1/2，相当于抛硬币等正面，平均抛 2 次出一次正面，所以 x 平均只会被卷进约 $2\log_{4/3} n$ 次划分，也就是 O(log n) 次。每个数平均被处理 O(log n) 次，n 个数合计就是期望 O(n log n)。更精确的计算结果是期望比较次数约 $2n\ln n \approx 1.39\, n\log_2 n$。

**最坏情况：每次都切成 0 和 n−1。** 基准每次恰好是区间里最小（或最大）的数，划分后一边是空的，另一边只少了基准这一个数。递归树退化成一条链，有 n 层，各层长度是 n, n−1, n−2, …, 1：

$$
n + (n-1) + \cdots + 1 = \frac{n(n+1)}{2} = O(n^2)
$$

固定选最左边当基准时，已排序的数组每一步都会撞上这种情况；比较加等号时，全是重复数字的数组也会这样（见下面的易错点）。随机选基准以后，要连续很多次都恰好抽中最值，概率极小，所以实际几乎碰不到最坏情况。

## 易错点

1. 随机找基准点。否则如果数组中大部分区域已经被排过序，每次固定选最左边的数当基准，已排序的数组每次都会把最小的数选成基准。划分结果是一边 0 个、一边 n−1 个，递归 n 层，总共 时间复杂度 O(n²)。

2. nums[r] > base，nums[l] < base 不要加等号，否则会被题目里大量重复数字卡爆。

例：[2, 2, 2, 2, 2]

- 加等号时：右指针遇到的每个 2 都满足"≥ 基准"，于是一路左移，直到撞上左指针。基准停在最左边，划分成 0 个和 4 个，下一轮还是同样的情况。每轮只少一个数，一共 n 轮，O(n²)。

- 不加等号时： 遇到相等的数就停下来搬家。相等的数被轮流搬到两边，两个指针在中间（下标 2）相遇。划分成 2 个和 2 个，递归只有 log n 层。

3. 递归的时候，不要把已经排序过的数传递进去，否则会无限循环。

单独加上随机或者单独不加等号都会超时，两个加上就不超时了。

## 复盘

新凯来面试的时候让讲快排原理。

虾皮笔试也遇到了这个知识点。

## 小结

快排的核心思路就是让排序后左边的数小于pivot，右边的大于pivot。

然后分治就是将大的数组变成小的数组，从小到大用相同的方法递归的解决这个问题。

## 相关题目

### [力扣 215. 数组中的第K个最大元素](https://leetcode.cn/problems/kth-largest-element-in-an-array/)（中等，笔试真题）

<details>
<summary>思路和代码（点击展开）</summary>

和本题用同一个划分：第 k 大的数就是升序排好后下标为 n−k 的数。划分一次后，基准落在下标 m：

- m 等于 n−k，基准就是答案；
- m 小于 n−k，答案在右边，只处理右边；
- m 大于 n−k，答案在左边，只处理左边。

每次只进入一边，不用两边都递归，这就是快速选择。期望时间 O(n)（n + n/2 + n/4 + … ≈ 2n），最坏 O(n²)；额外空间是递归栈，每次只递归一边，期望深度 O(log n)，最坏 O(n)。随机选基准和比较时不加等号这两点同样不能少，这题的测试数据里也有大量重复数字。

```python
import random

class Solution:
    def findKthLargest(self, nums: List[int], k: int) -> int:
        n = len(nums)
        def quickselect(left, right):
            l = left
            r = right
            if l >= r:
                return
            
            p = random.randint(left, right)
            nums[p], nums[l] = nums[l], nums[p]

            base = nums[l]
            blank = l

            while l < r:
                if blank == l:
                    if nums[r] > base:
                        r -= 1
                    else:
                        nums[l] = nums[r]
                        blank = r
                        l += 1
                else:
                    if nums[l] < base:
                        l += 1
                    else:
                        nums[r] = nums[l]
                        blank = l
                        r -= 1
            nums[l] = base
            if l < n - k:
                quickselect(l+1,right)
            elif l > n - k:
                quickselect(left,l-1)
            else:
                return
        quickselect(0, n - 1)

        return nums[n - k]
```

</details>
