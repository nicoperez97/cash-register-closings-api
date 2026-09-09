import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  CustomerOrderFulfillment,
  CustomerOrderPaymentMethod,
  CustomerOrderStatus,
} from '../../../entities/customer-order.entity';

export class CreateCustomerOrderItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  menuItemId: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  qty: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string | null;

  @ApiPropertyOptional({ type: [String], description: 'Ingredientes a retirar' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  removedIngredients?: string[];
}

export class CreateCustomerOrderExtraDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  extraId: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  qty: number;

  @ApiPropertyOptional({ description: 'Ítem de carta al que se adhiere el extra' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  attachedToMenuItemId?: string | null;
}

export class CreateCustomerOrderDto {
  @ApiProperty({ enum: CustomerOrderFulfillment })
  @IsEnum(CustomerOrderFulfillment)
  fulfillment: CustomerOrderFulfillment;

  @ApiProperty({ type: [CreateCustomerOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => CreateCustomerOrderItemDto)
  items: CreateCustomerOrderItemDto[];

  @ApiPropertyOptional({ type: [CreateCustomerOrderExtraDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => CreateCustomerOrderExtraDto)
  extras?: CreateCustomerOrderExtraDto[];

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName: string;

  @ApiPropertyOptional({ example: '11 2345 6789' })
  @ValidateIf((o: CreateCustomerOrderDto) => o.fulfillment !== CustomerOrderFulfillment.COUNTER)
  @IsString()
  @MinLength(6)
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({
    description: 'Solo mostrador: imprimir ticket del cliente (default true)',
  })
  @IsOptional()
  @IsBoolean()
  printCustomerTicket?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  deliveryZoneId?: string | null;

  @ApiProperty({ enum: CustomerOrderPaymentMethod })
  @IsEnum(CustomerOrderPaymentMethod)
  paymentMethod: CustomerOrderPaymentMethod;

  @ApiPropertyOptional({ description: 'Con cuánto abona (efectivo)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cashAmount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerNotes?: string | null;

  /** Solo staff/mostrador: descuento en % sobre el subtotal (0–100). */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number | null;

  /** Solo staff/mostrador: descuento en monto fijo (no combinar con %). */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discountFixed?: number | null;
}

export class UpdateCustomerOrderStatusDto {
  @ApiProperty({ enum: CustomerOrderStatus })
  @IsEnum(CustomerOrderStatus)
  status: CustomerOrderStatus;
}
