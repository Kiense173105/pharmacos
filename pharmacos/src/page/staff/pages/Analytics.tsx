import React, { useEffect, useState } from 'react';
import AnalyticsCard from './AnalyticsCard';
import SalesChart from './SalesChart';
import ProductsTable from './ProductsTable';
import InventoryGrid from './InventoryGrid';
import { TrendingUpIcon, PackageIcon, BoxesIcon } from 'lucide-react';
import { staffAnalyticsApi } from '@/lib/api';
import { apiFetch } from '@/lib/api';

// Thêm hàm formatVND giống bên Orders
const formatVND = (value: number | string) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(value));

// Hàm tính tổng giá trị các đơn hàng completed
function getTotalCompletedAmount(orders: any[]): number {
  return orders
    .filter(order => order.status === "completed")
    .reduce((sum, order) => {
      const calculatedTotal = order.items?.reduce(
        (s: number, item: any) => s + item.quantity * item.unitPrice,
        0
      ) || 0;
      return sum + calculatedTotal;
    }, 0);
}

export default function Analytics() {
  const [stats, setStats] = useState({
    totalSales: '0',
    salesChange: '0%',
    topProduct: 'N/A',
    topProductUnits: '0',
    inventoryCount: '0',
    inventoryChange: '0%',
  });
  const [salesData, setSalesData] = useState([]);
  const [productsData, setProductsData] = useState([]);
  const [inventoryData, setInventoryData] = useState([]);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [sales, products, inventory] = await Promise.all([
          staffAnalyticsApi.getSales(),
          staffAnalyticsApi.getProducts(),
          staffAnalyticsApi.getInventory(),
        ]);
        // SALES
        const monthlySales = sales?.salesByMonth || [];
        // SỬA: Lấy tổng tiền của tất cả đơn hàng đã mua (tổng totalAmount)
        let totalSalesAmount = 0;
        if (Array.isArray(monthlySales) && monthlySales.length > 0) {
          totalSalesAmount = monthlySales.reduce((sum, s) => sum + (s.totalSales || 0), 0);
        }
        setSalesData(monthlySales.map(item => ({
          month: `${item._id.year}-${String(item._id.month).padStart(2, '0')}`,
          sales: item.totalSales || 0,
          orders: item.orderCount || 0,
        })));
        // TOP PRODUCTS
        const topProducts = sales?.topSellingProducts || [];
        setProductsData(topProducts.map(product => ({
          id: product.product?._id || product._id || Math.random().toString(),
          name: product.product?.name || 'Unknown Product',
          category: product.product?.category || 'General',
          sales: product.totalQuantity || 0,
          revenue: product.totalRevenue || 0,
          rating: product.product?.rating || 0,
          stock: product.product?.stockQuantity || 0,
          image: product.product?.images?.[0]?.url || '',
        })));
        const topProductObj = topProducts[0];
        // INVENTORY
        const inventoryStatus = inventory?.inventoryStatus || {};
        setStats({
          totalSales: totalSalesAmount.toLocaleString(),
          salesChange: '+0%',
          topProduct: topProductObj?.product?.name || 'N/A',
          topProductUnits: topProductObj?.totalQuantity?.toString() || '0',
          inventoryCount: inventoryStatus.totalProducts?.toString() || '0',
          inventoryChange: '+0%',
        });
        setLowStockCount(inventoryStatus.lowStockProducts || 0);
        // LẤY TOÀN BỘ SẢN PHẨM TỒN KHO CHO BẢNG INVENTORY (KHÔNG PHÂN TRANG)
        const allProductsRes = await apiFetch('http://localhost:10000/api/staff/products?limit=1000');
        const allProducts = allProductsRes?.products || [];
        setInventoryData(allProducts.map(item => ({
          id: item._id,
          name: item.name,
          category: item.category,
          currentStock: item.stockQuantity,
          minStock: 50,
          value: (item.stockQuantity || 0) * (item.price || 0),
          status: (item.stockQuantity || 0) < 50 ? 'Low Stock' : 'In Stock',
        })));
        setLowStockCount(allProducts.filter(item => (item.stockQuantity || 0) < 50).length);
        // SỬA: Hiển thị tổng số sản phẩm (product) thay vì tổng số lượng tồn kho
        setStats(prev => ({
          ...prev,
          inventoryCount: allProducts.length.toString(),
        }));
        // Fetch orders để lấy tổng completed
        const token = localStorage.getItem("token");
        const ordersRes = await apiFetch("http://localhost:10000/api/orders/my-orders", {
          headers: { Authorization: `Bearer ${token}` }
        });
        const ordersData = Array.isArray(ordersRes) ? ordersRes : ordersRes?.orders || [];
        setOrders(ordersData);

        // === NEW: Calculate salesData from completed orders ===
        // Group completed orders by month
        const completedOrders = ordersData.filter((order: any) => order.status === "completed");
        const salesByMonthMap: { [key: string]: { sales: number; orders: number } } = {};
        completedOrders.forEach((order: any) => {
          const date = new Date(order.createdAt);
          const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          const orderTotal = order.items?.reduce((s: number, item: any) => s + item.quantity * item.unitPrice, 0) || 0;
          if (!salesByMonthMap[month]) {
            salesByMonthMap[month] = { sales: 0, orders: 0 };
          }
          salesByMonthMap[month].sales += orderTotal;
          salesByMonthMap[month].orders += 1;
        });
        // Convert to array and sort by month
        const salesDataFromOrders = Object.entries(salesByMonthMap)
          .map(([month, { sales, orders }]) => ({ month, sales, orders }))
          .sort((a, b) => a.month.localeCompare(b.month));
        setSalesData(salesDataFromOrders);
        // === END NEW ===

      } catch (error) {
        setStats({
          totalSales: '0',
          salesChange: '0%',
          topProduct: 'N/A',
          topProductUnits: '0',
          inventoryCount: '0',
          inventoryChange: '0%',
        });
        setSalesData([]);
        setProductsData([]);
        setInventoryData([]);
        setLowStockCount(0);
        setOrders([]);
      }
    }
    fetchStats();
  }, []);

  return (
    <div className="space-y-8">
      {/* Analytics Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <AnalyticsCard
          title="Total Sales"
          value={formatVND(getTotalCompletedAmount(orders))}
          change={stats.salesChange}
          changeType="increase"
          icon={TrendingUpIcon}
          iconColor="bg-blue-500"
        />
        <AnalyticsCard
          title="Top Product"
          value={stats.topProduct}
          change={stats.topProductUnits + ' units'}
          changeType="neutral"
          icon={PackageIcon}
          iconColor="bg-green-500"
        />
        <AnalyticsCard
          title="Inventory Items"
          value={stats.inventoryCount}
          change={stats.inventoryChange}
          changeType="neutral"
          icon={BoxesIcon}
          iconColor="bg-yellow-500"
        />
      </div>
      {/* Sales Chart và Products Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SalesChart data={salesData} />
        <ProductsTable products={productsData} />
      </div>
      {/* Inventory Grid */}
      <InventoryGrid inventory={inventoryData} lowStockCount={lowStockCount} />
    </div>
  );
}