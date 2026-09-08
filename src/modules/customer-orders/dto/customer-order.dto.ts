import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
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

  @ApiProperty({ example: '11 2345 6789' })
  @IsString()
  @MinLength(6)
  @MaxLength(40)
  phone: string;

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
}

export class UpdateCustomerOrderStatusDto {
  @ApiProperty({ enum: CustomerOrderStatus })
  @IsEnum(CustomerOrderStatus)
  status: CustomerOrderStatus;
}
